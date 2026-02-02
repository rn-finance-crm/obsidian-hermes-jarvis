import React from 'react';

interface HistoryButtonProps {
  onOpenHistory: () => void;
  isListening?: boolean;
}

const HistoryButton: React.FC<HistoryButtonProps> = ({ onOpenHistory, isListening }) => {
  return (
    <button 
      onClick={onOpenHistory}
      className="transition-all hermes-hover:text-normal border-none bg-transparent shadow-none opacity-60 hover:opacity-100"
      style={{
        color: isListening ? 'white' : undefined,
      }}
      title="View History"
    >
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </button>
  );
};

export default HistoryButton;
