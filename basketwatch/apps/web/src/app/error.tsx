"use client";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-[560px] px-5 pt-20">
      <h1 className="font-display text-[20px] font-semibold [font-stretch:expanded]">
        The board did not load
      </h1>
      <p className="mt-2 text-[13px] text-mute">
        {error.message || "The API did not answer."} Check that the API is running on port 3001.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded border border-line px-3 py-1.5 font-mono text-[11px] transition-colors hover:border-heal/40 hover:text-heal"
      >
        Try again
      </button>
    </main>
  );
}
