// The tutorial video on YouTube: one video of all twelve pages, with a chapter per page. The wiki
// pages link to their own chapter. The chapter times are the video's (design/video, compose.py
// writes them to tutorial-full.chapters.txt); a new render with different timings means new times here.

/** The video's address. */
export const VIDEO_URL = "https://www.youtube.com/watch?v=8b0JylzSSD0";

/** Where each page's chapter starts, in seconds, by page number; the last entry is where the closing starts. */
const STARTS = [90, 205, 328, 401, 497, 587, 665, 724, 817, 909, 980, 1033, 1183];

/**
 * A page's chapter: the link that starts the video there, and its length in whole minutes (at least one).
 * @param {number} number - The page's number, from 1.
 * @returns {{url: string, minutes: number} | null}
 */
export function videoChapter(number) {
    const start = STARTS[number - 1];
    const end = STARTS[number];
    if (start === undefined || end === undefined) return null;
    return { url: `${VIDEO_URL}&t=${start}s`, minutes: Math.max(1, Math.round((end - start) / 60)) };
}
