"use client";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-[560px] px-5 pt-20">
      <h1 className="font-display text-[26px]">The board did not load</h1>
      <p className="mt-2 text-[13px] text-mute">
        {error.message || "The API did not answer."} Check that the API is running on port 3001.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-5 text-[13px] underline decoration-1 underline-offset-4 transition-colors hover:text-heal"
      >
        Try again
      </button>
    </main>
  );
}
