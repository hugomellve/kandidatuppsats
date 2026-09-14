type PromptSong = {
  artist: string;
  title: string;
};

type PromptCandidate = {
  candidate_id: string;
  artist: string;
  title: string;
};

type BuildPromptParams = {
  candidateCount: number;
  recentGuesses: PromptSong[];
  lastSong: PromptSong | null;
  candidates: PromptCandidate[];
  promptSet?: PromptSetName;
};

export type PromptSetName =
  | "original"
  | "variant"
  | "variant-first-only"
  | "variant-second-after-first"
  | "variant-fourth";

type PromptSetTemplateName = "original" | "variant";

type PromptTemplate = string | ((params: BuildPromptParams) => string);

type PromptSet = {
  firstGeneration: PromptTemplate;
  secondGeneration: PromptTemplate;
  historyGeneration: PromptTemplate;
  fourthGeneration?: PromptTemplate;
};

function buildFirstDefaultPrompt(params: BuildPromptParams): string {
  return `
You are an intelligent recommendation system for a music service.

There are ${params.candidateCount} candidate songs that I can listen to next:
${JSON.stringify(params.candidates, null, 2)}

Please only pick one candidate_id from the candidates list. You can not recommend a song that is not in the list of candidates.

Think step-by-step internally, but output ONLY the JSON (formatted below).
---

OUTPUT FORMAT (STRICT JSON):

{
  "candidate_id": "candidate_n"
}
`;
}

function buildSecondDefaultPrompt(params: BuildPromptParams): string {
  return `
You are an intelligent recommendation system for a music service.

I've listened to the following songs in order recently:
${JSON.stringify(params.recentGuesses, null, 2)}

There are ${params.candidateCount} candidate songs that I can listen to next:
${JSON.stringify(params.candidates, null, 2)}

Please only pick one candidate_id from the candidates list. You can not recommend a song that is not in the list of candidates.

Think step-by-step internally, but output ONLY the JSON (formatted below).
---

OUTPUT FORMAT (STRICT JSON):

{
  "candidate_id": "candidate_n"
}
`;
}

function buildDefaultPrompt(params: BuildPromptParams): string {
  return `
You are an intelligent recommendation system for a music service.

If I've listened to the following songs in order recently:
${JSON.stringify(params.recentGuesses, null, 2)}

Then if I ask you to recommend a song according to my listening history, you should recommend
${JSON.stringify(params.lastSong, null, 2)}

and now that I've just listened to ${JSON.stringify(params.lastSong, null, 2)}
there are ${params.candidateCount} candidate songs that I can listen to next:
${JSON.stringify(params.candidates, null, 2)}
Please only pick one candidate_id from the candidates list. You can not recommend a song that is not in the list of candidates.

Think step-by-step internally, but output ONLY the JSON (formatted below).
---

OUTPUT FORMAT (STRICT JSON):

{
  "candidate_id": "candidate_n"
}
`;
}

// No history
function buildFirstvariantPrompt(params: BuildPromptParams): string {
  return `
You are an intelligent recommendation system for a music lyric guessing game.

There are ${params.candidateCount} candidate songs that I can guess the lyrics to next:
${JSON.stringify(params.candidates, null, 2)}

Please only pick one candidate_id from the candidates list. You can not recommend a song that is not in the list of candidates.

Think step-by-step internally, but output ONLY the JSON (formatted below).
---

OUTPUT FORMAT (STRICT JSON):

{
  "candidate_id": "candidate_n"
}
`;
}

// History
function buildSecondvariantPrompt(params: BuildPromptParams): string {
  return `
You are an intelligent recommendation system for a music lyric guessing game.

I've guessed the lyrics of the following songs in order recently:
${JSON.stringify(params.recentGuesses, null, 2)}

There are ${params.candidateCount} candidate songs that I can guess the lyrics to next:
${JSON.stringify(params.candidates, null, 2)}

Please only pick one candidate_id from the candidates list. You can not recommend a song that is not in the list of candidates.

Think step-by-step internally, but output ONLY the JSON (formatted below).
---

OUTPUT FORMAT (STRICT JSON):

{
  "candidate_id": "candidate_n"
}
`;
}

// ICL
function buildVariantPrompt(params: BuildPromptParams): string {
  return `
You are an intelligent recommendation system for a music lyric guessing game.

I've guessed the lyrics of the following songs in order recently:
${JSON.stringify(params.recentGuesses, null, 2)}

and then if I ask you to recommend a song according to my guessing history, you should recommend
${JSON.stringify(params.lastSong, null, 2)}

and now that I've just guessed the lyrics to ${JSON.stringify(params.lastSong, null, 2)}
there are ${params.candidateCount} candidate songs that I can guess the lyrics to next:
${JSON.stringify(params.candidates, null, 2)}
Please only pick one candidate_id from the candidates list. You can not recommend a song that is not in the list of candidates.

Think step-by-step internally, but output ONLY the JSON (formated below).
---

OUTPUT FORMAT (STRICT JSON):

{
  "candidate_id": "candidate_n"
}

`;
}

// recency focus
function buildFourthVariantPrompt(params: BuildPromptParams): string {
  return `
You are an intelligent recommendation system for a music lyric guessing game.

I've guessed the lyrics of the following songs in order recently:
${JSON.stringify(params.recentGuesses, null, 2)}

There are ${params.candidateCount} candidate songs that I can guess the lyrics to next:
${JSON.stringify(params.candidates, null, 2)}
Please only pick one candidate_id from the candidates list. You can not recommend a song that is not in the list of candidates.

Note that my most recently guessed song is:
${JSON.stringify(params.lastSong, null, 2)}

Think step-by-step internally, but output ONLY the JSON (formated below).
---

OUTPUT FORMAT (STRICT JSON):

{
  "candidate_id": "candidate_n"
}

`;
}

const PROMPT_SETS: Record<PromptSetTemplateName, PromptSet> = {
  original: {
    firstGeneration: buildFirstDefaultPrompt,
    secondGeneration: buildSecondDefaultPrompt,
    historyGeneration: buildDefaultPrompt,
  },
  variant: {
    firstGeneration: buildFirstvariantPrompt,
    secondGeneration: buildSecondvariantPrompt,
    historyGeneration: buildVariantPrompt,
    fourthGeneration: buildFourthVariantPrompt,
  },
};

function resolvePrompt(
  prompt: PromptSet["historyGeneration"],
  params: BuildPromptParams
): string {
  return typeof prompt === "function" ? prompt(params) : prompt;
}

export function buildLyricPrompt(params: BuildPromptParams): string {
  if (params.promptSet === "variant-fourth") {
    return resolvePrompt(PROMPT_SETS.variant.fourthGeneration ?? "", params);
  }

  if (params.promptSet === "variant-first-only") {
    return resolvePrompt(PROMPT_SETS.variant.firstGeneration, params);
  }

  if (params.promptSet === "variant-second-after-first") {
    if (!params.lastSong && params.recentGuesses.length === 0) {
      return resolvePrompt(PROMPT_SETS.variant.firstGeneration, params);
    }

    return resolvePrompt(PROMPT_SETS.variant.secondGeneration, params);
  }

  const promptSet = PROMPT_SETS[params.promptSet ?? "original"];

  if (!params.lastSong && params.recentGuesses.length === 0) {
    return resolvePrompt(promptSet.firstGeneration, params);
  }

  if (params.lastSong && params.recentGuesses.length === 0) {
    return resolvePrompt(promptSet.secondGeneration, params);
  }

  return resolvePrompt(promptSet.historyGeneration, params);
}
