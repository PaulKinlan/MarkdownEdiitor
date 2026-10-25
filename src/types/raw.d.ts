// Vite's `?raw` imports: the file's text as a string.
declare module "*?raw" {
  const text: string;
  export default text;
}

/** Vite: a worker module's built URL. */
declare module "*?worker&url" {
  const url: string;
  export default url;
}
