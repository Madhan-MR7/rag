import "./styles/ChatInput.css";

function ChatInput({ message, setMessage, sendMessage }) {
  return (
    <div className="chat-input">
      <input
        value={message}
        placeholder="Ask about an exercise..."
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            sendMessage();
          }
        }}
      />

      <button onClick={sendMessage}>Send</button>
    </div>
  );
}

export default ChatInput;
