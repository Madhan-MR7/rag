import { useState, useEffect } from "react";
import { auth } from "./firebase/config";
import {
  saveImage,
  getUserImages,
} from "./imageDB";

function ImageUpload() {
  const [file, setFile] = useState(null);
  const [images, setImages] = useState([]);

  useEffect(() => {
    loadImages();
  }, []);

  const loadImages = async () => {
    const data = await getUserImages(
      auth.currentUser.uid
    );

    setImages(data);
  };

  const handleUpload = async () => {
    if (!file) return;

    await saveImage(
      file,
      auth.currentUser.uid
    );

    setFile(null);
    loadImages();
  };

  return (
    <div>
      <input
        type="file"
        onChange={(e) =>
          setFile(e.target.files[0])
        }
      />

      <button onClick={handleUpload}>
        Upload
      </button>

      <div>
        {images.map((img) => (
          <img
            key={img.id}
            src={img.image}   // 🔥 BASE64 DIRECT
            width="150"
          />
        ))}
      </div>
    </div>
  );
}

export default ImageUpload;