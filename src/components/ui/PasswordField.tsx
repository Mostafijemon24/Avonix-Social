"use client";

import { useState } from "react";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { generateStrongPassword } from "@/lib/generatePassword";

type PasswordFieldProps = {
  label: string;
  name: string;
  required?: boolean;
  autoComplete?: string;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Show Generate button (register / new password). */
  showGenerate?: boolean;
  /** Called when Generate produces a new password (in addition to onChange). */
  onGenerate?: (value: string) => void;
};

export function PasswordField({
  label,
  name,
  required,
  autoComplete = "current-password",
  placeholder,
  value,
  defaultValue,
  onChange,
  showGenerate = false,
  onGenerate,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const [internal, setInternal] = useState(defaultValue ?? "");
  const controlled = value !== undefined;
  const current = controlled ? value : internal;

  const setValue = (next: string) => {
    if (!controlled) setInternal(next);
    onChange?.(next);
  };

  const handleGenerate = () => {
    const next = generateStrongPassword();
    setValue(next);
    setVisible(true);
    onGenerate?.(next);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <label className="block font-bold text-slate-300">{label}</label>
        {showGenerate && (
          <button
            type="button"
            onClick={handleGenerate}
            className="inline-flex items-center gap-1 text-[10px] font-bold text-orange-400 hover:text-orange-300"
          >
            <RefreshCw className="w-3 h-3" aria-hidden />
            Generate
          </button>
        )}
      </div>
      <div className="relative">
        <input
          type={visible ? "text" : "password"}
          name={name}
          required={required}
          placeholder={placeholder}
          autoComplete={autoComplete}
          value={controlled || showGenerate ? current : undefined}
          defaultValue={!controlled && !showGenerate ? defaultValue : undefined}
          onChange={(e) => setValue(e.target.value)}
          className="w-full border border-navy-700 rounded-xl p-3 pr-11 bg-navy-950 font-bold text-white"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-navy-800"
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
