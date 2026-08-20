import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-[560px] px-5 pt-20">
      <h1 className="font-display text-[20px] font-semibold [font-stretch:expanded]">
        No such page
      </h1>
      <p className="mt-2 text-[13px] text-mute">That address does not match anything here.</p>
      <Link
        href="/"
        className="mt-4 inline-block rounded border border-line px-3 py-1.5 font-mono text-[11px] transition-colors hover:border-heal/40 hover:text-heal"
      >
        Back to the board
      </Link>
    </main>
  );
}
