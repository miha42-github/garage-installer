import { Table } from "@cliffy/table";
import { green, red, yellow, bold } from "@std/fmt/colors";
import type { CheckResult } from "../checks/system.ts";

export class DisplayManager {
  showCheckResults(results: CheckResult[]): void {
    const table = new Table()
      .header([bold("Check"), bold("Status"), bold("Details")])
      .border(true);

    for (const result of results) {
      const status = result.passed ? green("✓ PASS") : red("✗ FAIL");
      table.push([
        result.name,
        status,
        result.message,
      ]);
    }

    table.render();
  }

  showProgress(message: string): void {
    console.log(`  ${message}...`);
  }

  showSuccess(message: string): void {
    console.log(green(`✓ ${message}`));
  }

  showWarning(message: string): void {
    console.log(yellow(`⚠ ${message}`));
  }

  showError(message: string): void {
    console.log(red(`✖ ${message}`));
  }

  showInfo(message: string): void {
    console.log(`ℹ ${message}`);
  }
}
