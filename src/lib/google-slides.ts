import type { Deck, Slide } from "./schemas";

interface SlideRequest {
  createSlide: {
    objectId: string;
    slideLayoutReference: { predefinedLayout: string };
  };
}

interface TextRequest {
  insertText: {
    objectId: string;
    text: string;
    insertionIndex: number;
  };
}

type BatchRequest = SlideRequest | TextRequest | Record<string, unknown>;

export async function exportToGoogleSlides(
  deck: Deck,
  accessToken: string
): Promise<string> {
  // Create presentation
  const createRes = await fetch(
    "https://slides.googleapis.com/v1/presentations",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: `${deck.company} — Technical Solution Deck`,
      }),
    }
  );

  if (!createRes.ok) {
    throw new Error(`Failed to create presentation: ${createRes.statusText}`);
  }

  const presentation = await createRes.json();
  const presentationId = presentation.presentationId;

  // Build batch update requests
  const requests: BatchRequest[] = [];

  // Delete default blank slide
  if (presentation.slides?.length > 0) {
    requests.push({
      deleteObject: { objectId: presentation.slides[0].objectId },
    });
  }

  for (const slide of deck.slides) {
    const slideId = `slide_${slide.slide_number}`;
    const titleId = `title_${slide.slide_number}`;
    const bodyId = `body_${slide.slide_number}`;

    requests.push({
      createSlide: {
        objectId: slideId,
        slideLayoutReference: { predefinedLayout: "TITLE_AND_BODY" },
        placeholderIdMappings: [
          { layoutPlaceholder: { type: "TITLE" }, objectId: titleId },
          { layoutPlaceholder: { type: "BODY" }, objectId: bodyId },
        ],
      },
    });

    requests.push({
      insertText: {
        objectId: titleId,
        text: slide.title,
        insertionIndex: 0,
      },
    });

    const bodyText = [
      ...slide.talking_points.map((tp) => `• ${tp}`),
      "",
      `Features: ${slide.features.join(", ")}`,
      "",
      `Sources: ${slide.sources.join(", ")}`,
    ].join("\n");

    requests.push({
      insertText: {
        objectId: bodyId,
        text: bodyText,
        insertionIndex: 0,
      },
    });
  }

  // Execute batch update
  const batchRes = await fetch(
    `https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requests }),
    }
  );

  if (!batchRes.ok) {
    throw new Error(`Failed to update presentation: ${batchRes.statusText}`);
  }

  return `https://docs.google.com/presentation/d/${presentationId}/edit`;
}
