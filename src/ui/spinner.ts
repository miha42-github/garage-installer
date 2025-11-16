import { dim, green, red } from "@std/fmt/colors";

export class Spinner {
  private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private currentFrame = 0;
  private interval: number | null = null;
  private message: string;

  constructor(message: string) {
    this.message = message;
  }

  start(): void {
    if (this.interval !== null) return;

    // Hide cursor
    Deno.stdout.writeSync(new TextEncoder().encode("\x1b[?25l"));

    this.interval = setInterval(() => {
      const frame = this.frames[this.currentFrame];
      const text = `${dim(frame)} ${this.message}`;
      Deno.stdout.writeSync(new TextEncoder().encode(`\r${text}\r`));
      this.currentFrame = (this.currentFrame + 1) % this.frames.length;
    }, 80);
  }

  update(message: string): void {
    this.message = message;
  }

  succeed(message?: string): void {
    this.stop();
    const finalMessage = message || this.message;
    console.log(`${green("✓")} ${finalMessage}`);
  }

  fail(message?: string): void {
    this.stop();
    const finalMessage = message || this.message;
    console.log(`${red("✗")} ${finalMessage}`);
  }

  stop(): void {
    if (this.interval === null) return;

    clearInterval(this.interval);
    this.interval = null;

    // Clear line and show cursor
    Deno.stdout.writeSync(new TextEncoder().encode("\r\x1b[K\x1b[?25h"));
  }
}

export async function withSpinner<T>(
  message: string,
  fn: (spinner: Spinner) => Promise<T>
): Promise<T> {
  const spinner = new Spinner(message);
  spinner.start();
  try {
    const result = await fn(spinner);
    spinner.succeed();
    return result;
  } catch (error) {
    spinner.fail();
    throw error;
  }
}
