import { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "destructive";
}

export function Button({ variant = "default", className = "", ...props }: ButtonProps) {
  const base = "px-4 py-2 rounded-xl font-semibold transition";
  const styles =
    variant === "outline"
      ? "border border-gray-400 bg-white text-black hover:bg-gray-100"
      : variant === "destructive"
        ? "bg-red-600 text-white hover:bg-red-700"
        : "bg-blue-600 text-white hover:bg-blue-700";

  return (
    <button className={`${base} ${styles} ${className}`} {...props} />
  );
}
