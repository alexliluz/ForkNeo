export type OutputWriter = (message: string) => void;

export const consoleWriter: OutputWriter = (message) => console.log(message);
