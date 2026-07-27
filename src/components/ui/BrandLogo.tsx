import Link from "next/link";

export function BrandLogo({
  href = "/",
  size = "md",
}: {
  href?: string;
  size?: "sm" | "md";
}) {
  const box = size === "sm" ? "w-9 h-9 text-lg" : "w-10 h-10 text-xl";
  const text = size === "sm" ? "text-xl" : "text-2xl";

  return (
    <Link href={href} className="flex items-center space-x-3">
      <div
        className={`${box} rounded-xl bg-orange-500 flex items-center justify-center font-black text-white shadow-lg shadow-orange-500/30`}
      >
        AX
      </div>
      <span className={`${text} font-black tracking-tight text-white`}>
        Avonix<span className="text-orange-500">.Social</span>
      </span>
    </Link>
  );
}
