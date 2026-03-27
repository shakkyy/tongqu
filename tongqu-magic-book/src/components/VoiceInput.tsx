import { Mic, MicOff } from "lucide-react";

interface VoiceInputProps {
  isListening: boolean;
  onToggle: () => void;
}

export function VoiceInput({ isListening, onToggle }: VoiceInputProps) {
  return (
    <div className="relative flex items-center justify-center w-full">
      <div className="relative">
        {isListening && (
          <>
            <span className="absolute inset-0 rounded-full bg-cn-red/25 animate-[ping_1.5s_ease-out_infinite]" />
            <span className="absolute inset-0 rounded-full bg-cn-yellow/30 animate-[ping_2s_ease-out_infinite_0.5s]" />
          </>
        )}
        
        <button
          type="button"
          onClick={onToggle}
          className={`relative z-10 flex h-24 w-24 items-center justify-center rounded-full border-4 border-cn-ink shadow-[4px_6px_0px_#1A2B3C] transition-all hover:-translate-y-1 hover:shadow-[6px_8px_0px_#1A2B3C] active:translate-y-1 active:shadow-[0px_0px_0px_#1A2B3C] ${
            isListening ? "bg-cn-red text-white" : "bg-cn-azure text-white"
          }`}
          aria-label={isListening ? "停止语音输入" : "开始语音输入"}
        >
          {isListening ? (
            <MicOff className="h-12 w-12" strokeWidth={2.5} />
          ) : (
            <Mic className="h-12 w-12" strokeWidth={2.5} />
          )}
        </button>
      </div>
    </div>
  );
}
