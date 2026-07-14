const DB_NAME = "fitgpt_images_db";
const STORE_NAME = "images";

const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
      }
    };

    request.onsuccess = () =>
      resolve(request.result);

    request.onerror = () =>
      reject("DB error");
  });
};

// ✅ SAVE IMAGE AS BASE64 (THIS IS KEY)
export const saveImage = async (file, userId) => {
  const db = await openDB();

  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = () => {
      const base64 = reader.result; // 🔥 REAL IMAGE DATA

      const tx = db.transaction(
        STORE_NAME,
        "readwrite"
      );

      tx.objectStore(STORE_NAME).add({
        userId,
        image: base64, // ❗ STORE BASE64, NOT URL
        createdAt: Date.now(),
      });

      resolve(true);
    };

    reader.readAsDataURL(file); // 🔥 IMPORTANT LINE
  });
};

export const getUserImages = async (userId) => {
  const db = await openDB();

  return new Promise((resolve) => {
    const tx = db.transaction(
      STORE_NAME,
      "readonly"
    );

    const store = tx.objectStore(STORE_NAME);

    const request = store.getAll();

    request.onsuccess = () => {
      const result = request.result.filter(
        (img) => img.userId === userId
      );

      resolve(result);
    };
  });
};