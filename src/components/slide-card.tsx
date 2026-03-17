"use client";

import type { Slide } from "@/lib/schemas";

interface SlideCardProps {
  slide: Slide;
  onChange: (updated: Slide) => void;
}

export function SlideCard({ slide, onChange }: SlideCardProps) {
  function updateField<K extends keyof Slide>(field: K, value: Slide[K]) {
    onChange({ ...slide, [field]: value });
  }

  function updateTalkingPoint(idx: number, value: string) {
    const updated = [...slide.talking_points];
    updated[idx] = value;
    updateField("talking_points", updated);
  }

  function removeTalkingPoint(idx: number) {
    updateField(
      "talking_points",
      slide.talking_points.filter((_, i) => i !== idx)
    );
  }

  function addTalkingPoint() {
    updateField("talking_points", [...slide.talking_points, ""]);
  }

  function updateFeature(idx: number, value: string) {
    const updated = [...slide.features];
    updated[idx] = value;
    updateField("features", updated);
  }

  function removeFeature(idx: number) {
    updateField(
      "features",
      slide.features.filter((_, i) => i !== idx)
    );
  }

  function addFeature() {
    updateField("features", [...slide.features, ""]);
  }

  const groundingColor =
    slide.grounding_status === "grounded"
      ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
      : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300";

  return (
    <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-500">
          Slide {slide.slide_number}
        </span>
        {slide.grounding_status && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded ${groundingColor}`}>
            {slide.grounding_status === "grounded" ? "Grounded" : "Needs review"}
          </span>
        )}
      </div>

      <input
        value={slide.title}
        onChange={(e) => updateField("title", e.target.value)}
        className="w-full text-lg font-semibold bg-transparent border-b border-transparent hover:border-neutral-300 focus:border-blue-500 outline-none pb-1"
      />

      <div className="space-y-2">
        <p className="text-xs font-medium text-neutral-500 uppercase">
          Talking Points
        </p>
        {slide.talking_points.map((tp, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="text-neutral-400 mt-1.5">-</span>
            <input
              value={tp}
              onChange={(e) => updateTalkingPoint(i, e.target.value)}
              className="flex-1 text-sm bg-transparent border-b border-transparent hover:border-neutral-300 focus:border-blue-500 outline-none py-1"
            />
            <button
              onClick={() => removeTalkingPoint(i)}
              className="text-neutral-400 hover:text-red-500 text-sm cursor-pointer"
            >
              x
            </button>
          </div>
        ))}
        <button
          onClick={addTalkingPoint}
          className="text-xs text-blue-600 hover:text-blue-700 cursor-pointer"
        >
          + Add talking point
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-neutral-500 uppercase">
          Features
        </p>
        <div className="flex flex-wrap gap-1.5">
          {slide.features.map((f, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-sm rounded"
            >
              <input
                value={f}
                onChange={(e) => updateFeature(i, e.target.value)}
                className="bg-transparent outline-none w-auto min-w-[60px]"
                size={Math.max(f.length, 5)}
              />
              <button
                onClick={() => removeFeature(i)}
                className="hover:text-red-500 cursor-pointer"
              >
                x
              </button>
            </span>
          ))}
          <button
            onClick={addFeature}
            className="text-xs text-blue-600 hover:text-blue-700 cursor-pointer px-2 py-0.5"
          >
            + Add
          </button>
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-neutral-500 uppercase mb-1">
          Sources
        </p>
        <div className="flex flex-wrap gap-2">
          {slide.sources.map((s, i) => (
            <a
              key={i}
              href={s}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:text-blue-700 underline"
            >
              {s.replace(/https?:\/\//, "").slice(0, 40)}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
