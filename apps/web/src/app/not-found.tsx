import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-[560px] px-5 pt-20">
      <h1 className="font-display text-[26px]">No such page</h1>
      <p className="mt-2 text-[13px] text-mute">That address does not match anything here.</p>
      <Link
        href="/"
        className="mt-5 inline-block text-[13px] underline decoration-1 underline-offset-4 transition-colors hover:text-heal"
      >
        Back to the basket
      </Link>
    </main>
  );
}
