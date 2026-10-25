// Vite's `?raw` imports: the file's text as a string.
declare module "*?raw" {
  const text: string;
  export default text;
}
