import Link from "next/link";

export function BrandLogo({
  href = "/",
  size = "md",
  compactOnMobile = false,
}: {
  href?: string;
  size?: "sm" | "md";
  compactOnMobile?: boolean;
}) {
  const box = size === "sm" ? "w-9 h-9 text-lg" : "w-10 h-10 text-xl";
  const text = size === "sm" ? "text-xl" : "text-2xl";

  return (
    <Link href={href} className="flex items-center space-x-3 min-w-0">
      <div
        className={`${box} rounded-xl bg-orange-500 flex items-center justify-center font-black text-white shadow-lg shadow-orange-500/30 shrink-0`}
      >
        AX
      </div>
      <span
        className={`${text} font-black tracking-tight text-ink ${
          compactOnMobile ? "hidden sm:inline" : ""
        }`}
      >
        Avonix<span className="text-orange-500">.Social</span>
      </span>
    </Link>
  );
}
