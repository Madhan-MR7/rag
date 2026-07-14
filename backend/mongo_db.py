"""
mongo_db.py
=====================================
MongoDB connection + data access layer for FitGPT.

Replaces Firestore for:
  - chats        (chat sessions per user)
  - messages     (every message in a chat, including embedded exercise data)
  - images       (GridFS - both user-uploaded attachments AND cached
                   SerpAPI exercise images, distinguished by metadata.type)

SETUP REQUIRED (see .env):
  MONGO_URI=mongodb://localhost:27017
  MONGO_DB_NAME=fitgpt

Run once (optional but recommended) to create indexes:
  python mongo_db.py
"""

import os
import io
import httpx
from datetime import datetime, timezone
from bson import ObjectId
from bson.errors import InvalidId

from pymongo import MongoClient, ASCENDING, DESCENDING
import gridfs

from dotenv import load_dotenv

load_dotenv()

# =====================================================
# CONNECTION
# =====================================================

MONGO_URI     = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "fitgpt")

client = MongoClient(MONGO_URI)
db     = client[MONGO_DB_NAME]

chats_col    = db["chats"]
messages_col = db["messages"]
users_col    = db["users"]

# One GridFS bucket for ALL images. We tell them apart using
# metadata.type: "upload" (user-attached file) or "exercise_cache"
# (downloaded copy of a SerpAPI image, keyed by exercise name + source
# url so we don't re-download / re-hit SerpAPI for the same image twice).
fs = gridfs.GridFS(db, collection="images")


def ensure_indexes():
    """Call once at startup (or run this file directly) to create indexes."""
    chats_col.create_index([("userId", ASCENDING), ("createdAt", DESCENDING)])
    messages_col.create_index([("chatId", ASCENDING), ("createdAt", ASCENDING)])
    db["images.files"].create_index([("metadata.userId", ASCENDING)])
    db["images.files"].create_index(
        [("metadata.exerciseName", ASCENDING), ("metadata.sourceUrl", ASCENDING)]
    )
    print("[Mongo] Indexes ensured.")


def _now():
    return datetime.now(timezone.utc)


def _oid(id_str: str) -> ObjectId:
    """Safely convert a string id to ObjectId, raising a clean error if invalid."""
    try:
        return ObjectId(id_str)
    except (InvalidId, TypeError):
        raise ValueError(f"Invalid id: {id_str}")


def _serialize(doc: dict) -> dict:
    """Convert Mongo's ObjectId/datetime fields into JSON-friendly values."""
    if not doc:
        return doc
    doc = dict(doc)
    if "_id" in doc:
        doc["id"] = str(doc.pop("_id"))
    for key, val in doc.items():
        if isinstance(val, datetime):
            doc[key] = val.isoformat()
        if isinstance(val, ObjectId):
            doc[key] = str(val)
    return doc


# =====================================================
# CHATS
# =====================================================

def create_chat(user_id: str, title: str = "New Chat") -> dict:
    doc = {
        "userId": user_id,
        "title": title,
        "createdAt": _now(),
    }
    result = chats_col.insert_one(doc)
    doc["_id"] = result.inserted_id
    return _serialize(doc)


def list_chats(user_id: str) -> list[dict]:
    cursor = chats_col.find({"userId": user_id}).sort("createdAt", DESCENDING)
    return [_serialize(c) for c in cursor]


def update_chat_title(chat_id: str, title: str) -> None:
    short_title = title if len(title) <= 25 else title[:25] + "..."
    chats_col.update_one({"_id": _oid(chat_id)}, {"$set": {"title": short_title}})


def delete_chat(chat_id: str) -> None:
    """Deletes the chat, all its messages, and any images tied to those messages."""
    oid = _oid(chat_id)

    # Remove any images (uploads) tagged with this chatId
    for f in db["images.files"].find({"metadata.chatId": chat_id}):
        fs.delete(f["_id"])

    messages_col.delete_many({"chatId": chat_id})
    chats_col.delete_one({"_id": oid})


# =====================================================
# MESSAGES
# =====================================================

def add_message(chat_id: str, user_id: str, message: dict) -> dict:
    """
    message can contain any of: role, text, exercise (dict), images (list of
    image ids/urls), isFile, fileName, fileImageId, etc. Whatever shape the
    frontend needs — we store it as-is plus bookkeeping fields.
    """
    doc = {
        **message,
        "chatId": chat_id,
        "userId": user_id,
        "createdAt": _now(),
    }
    result = messages_col.insert_one(doc)
    doc["_id"] = result.inserted_id
    return _serialize(doc)


def list_messages(chat_id: str) -> list[dict]:
    cursor = messages_col.find({"chatId": chat_id}).sort("createdAt", ASCENDING)
    return [_serialize(m) for m in cursor]


# =====================================================
# USERS
# =====================================================

def upsert_user(user_id: str, email: str = "") -> None:
    users_col.update_one(
        {"uid": user_id},
        {"$setOnInsert": {"uid": user_id, "email": email, "createdAt": _now()}},
        upsert=True,
    )


# =====================================================
# IMAGES (GridFS)
# =====================================================

def save_image_bytes(
    file_bytes: bytes,
    filename: str,
    content_type: str,
    user_id: str,
    chat_id: str | None = None,
    image_type: str = "upload",
    exercise_name: str | None = None,
    source_url: str | None = None,
) -> str:
    """
    Stores raw image bytes in GridFS. Returns the string id to hand back
    to the frontend (used later to build a /image/{id} URL).
    """
    metadata = {
        "type": image_type,          # "upload" | "exercise_cache"
        "userId": user_id,
        "chatId": chat_id,
        "contentType": content_type,
        "exerciseName": exercise_name,
        "sourceUrl": source_url,     # the original external image url — used
                                      # to dedupe/cache per-image, not just
                                      # per-exercise (see get_cached_exercise_image_id)
        "uploadedAt": _now(),
    }
    file_id = fs.put(
        file_bytes,
        filename=filename,
        content_type=content_type,
        metadata=metadata,
    )
    return str(file_id)


def get_image(image_id: str):
    """Returns (bytes, content_type) or (None, None) if not found."""
    try:
        grid_out = fs.get(_oid(image_id))
    except (gridfs.NoFile, ValueError):
        return None, None
    return grid_out.read(), grid_out.content_type


def get_cached_exercise_image_id(exercise_name: str, image_url: str) -> str | None:
    """
    Check if we've already downloaded+cached THIS EXACT image url for this
    exercise. Must match on both exerciseName AND sourceUrl — matching on
    exerciseName alone would collapse every distinct SerpAPI image for the
    same exercise onto whichever one got cached first (this was the bug
    that made all 3 SerpAPI images collapse into 1 repeated image).
    """
    f = db["images.files"].find_one({
        "metadata.type": "exercise_cache",
        "metadata.exerciseName": exercise_name,
        "metadata.sourceUrl": image_url,
    })
    return str(f["_id"]) if f else None


def cache_exercise_image_from_url(exercise_name: str, image_url: str) -> str | None:
    """
    Downloads an external image (e.g. from SerpAPI) and stores it in GridFS
    so we don't depend on external URLs staying alive, and don't re-fetch
    the same exact image url repeatedly.
    Returns the internal image id, or None if the download failed.
    """
    existing = get_cached_exercise_image_id(exercise_name, image_url)
    if existing:
        return existing

    try:
        resp = httpx.get(image_url, timeout=15.0, follow_redirects=True)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "image/jpeg")
        return save_image_bytes(
            file_bytes=resp.content,
            filename=f"{exercise_name}.jpg",
            content_type=content_type,
            user_id="system",
            image_type="exercise_cache",
            exercise_name=exercise_name,
            source_url=image_url,
        )
    except Exception as e:
        print(f"[Mongo] Failed to cache image for '{exercise_name}' ({image_url}): {e}")
        return None


def delete_image(image_id: str) -> None:
    try:
        fs.delete(_oid(image_id))
    except (gridfs.NoFile, ValueError):
        pass

# =====================================================
# ADD TO mongodb.py
# -----------------------------------------------------
# Paste this block near the bottom of mongodb.py, ABOVE the
#   if __name__ == "__main__":
# line. It reuses the existing `db`, `_now`, `_oid`, `_serialize`
# helpers already defined in that file — no new imports needed.
# =====================================================

profiles_col      = db["user_profiles"]
workout_plans_col = db["workout_plans"]


# =====================================================
# USER PROFILES  (for the workout generator)
# =====================================================

def save_user_profile(user_id: str, profile: dict) -> dict:
    """
    Upserts the fitness profile used to generate a workout plan.
    profile keys: name, height_cm, weight_kg, body_fat_pct,
                  injuries, experience_level, goal, days_per_week
    """
    doc = {**profile, "userId": user_id, "updatedAt": _now()}
    profiles_col.update_one(
        {"userId": user_id},
        {"$set": doc, "$setOnInsert": {"createdAt": _now()}},
        upsert=True,
    )
    return _serialize(profiles_col.find_one({"userId": user_id}))


def get_user_profile(user_id: str) -> dict | None:
    doc = profiles_col.find_one({"userId": user_id})
    return _serialize(doc) if doc else None


# =====================================================
# WORKOUT PLANS
# =====================================================

def save_workout_plan(user_id: str, plan: dict) -> dict:
    """
    Stores a freshly generated 12-week plan. We keep history (one document
    per generation) so a user can regenerate without losing older plans,
    but list_workout_plans/get_latest_workout_plan always surface the
    newest one by default.
    """
    doc = {
        **plan,
        "userId": user_id,
        "createdAt": _now(),
    }
    result = workout_plans_col.insert_one(doc)
    doc["_id"] = result.inserted_id
    return _serialize(doc)


def get_latest_workout_plan(user_id: str) -> dict | None:
    doc = workout_plans_col.find_one(
        {"userId": user_id}, sort=[("createdAt", DESCENDING)]
    )
    return _serialize(doc) if doc else None


def list_workout_plans(user_id: str) -> list[dict]:
    cursor = workout_plans_col.find({"userId": user_id}).sort("createdAt", DESCENDING)
    return [_serialize(p) for p in cursor]


def delete_workout_plan(plan_id: str) -> None:
    workout_plans_col.delete_one({"_id": _oid(plan_id)})


# Also add these two lines inside ensure_indexes() in mongodb.py:
#
#   profiles_col.create_index([("userId", ASCENDING)], unique=True)
#   workout_plans_col.create_index([("userId", ASCENDING), ("createdAt", DESCENDING)])

if __name__ == "__main__":
    ensure_indexes()