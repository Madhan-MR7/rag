function MessageBubble({ role, text, fileUrl, fileName, isFile }) {

  if (isFile) {
    return (
      <div className={`message ${role}`}>
        <a
          href={fileUrl}
          target="_blank"
          rel="noreferrer"
        >
          {fileName}
        </a>
      </div>
    );
  }

  return (
    <div className={`message ${role}`}>
      {text}
    </div>
  );
}

export default MessageBubble;