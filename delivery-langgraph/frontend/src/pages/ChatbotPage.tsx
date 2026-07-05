import React from 'react';
import ChatbotWidget from '../components/ChatbotWidget';

export default function ChatbotPage() {
  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-2">
      <div className="w-full max-w-md h-screen max-h-[700px] rounded-2xl shadow-2xl overflow-hidden border border-gray-700">
        <ChatbotWidget />
      </div>
    </div>
  );
}
