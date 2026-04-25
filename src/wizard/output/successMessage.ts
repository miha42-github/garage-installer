import { green, cyan, bold, dim } from "@std/fmt/colors";

export interface SuccessNodes {
  node1: { host: string; username: string };
  node2: { host: string };
  s3ApiPort: number;
}

export function showSuccessMessage(nodes: SuccessNodes): void {
  const { node1, node2, s3ApiPort } = nodes;

  console.log("\n" + "═".repeat(60));
  console.log(bold(green("Your Garage cluster is ready!")));
  console.log("═".repeat(60));

  console.log("\n" + bold("S3 API Endpoints:"));
  console.log(`  http://${node1.host}:${s3ApiPort}`);
  console.log(`  http://${node2.host}:${s3ApiPort}`);

  console.log("\n" + bold("Quick Start - Using AWS CLI:"));
  console.log(dim("  # Configure AWS CLI"));
  console.log(dim(`  aws configure set aws_access_key_id <your-key-id>`));
  console.log(dim(`  aws configure set aws_secret_access_key <your-secret-key>`));
  console.log(dim(`  aws configure set default.region garage`));
  console.log(dim(""));
  console.log(dim("  # Create a bucket"));
  console.log(
    dim(`  aws --endpoint-url http://${node1.host}:${s3ApiPort} s3 mb s3://my-bucket`)
  );
  console.log(dim(""));
  console.log(dim("  # Upload a file"));
  console.log(
    dim(
      `  aws --endpoint-url http://${node1.host}:${s3ApiPort} s3 cp file.txt s3://my-bucket/`
    )
  );

  console.log("\n" + bold("Or manage via Garage CLI:"));
  console.log(dim("  # SSH to a node"));
  console.log(dim(`  ssh ${node1.username}@${node1.host}`));
  console.log(dim(""));
  console.log(dim("  # Create bucket and key"));
  console.log(dim(`  docker exec garage /garage bucket create my-bucket`));
  console.log(dim(`  docker exec garage /garage key create my-key`));
  console.log(dim(`  docker exec garage /garage bucket allow my-bucket --read --write --key my-key`));
  console.log(dim(`  docker exec garage /garage key info my-key`));

  console.log("\n" + bold("Documentation:"));
  console.log("  https://garagehq.deuxfleurs.fr/documentation/");
  console.log("\n");
}

export function showAWSCLISetup(endpoint: string): void {
  console.log("\n" + "═".repeat(60));
  console.log(bold(cyan("AWS CLI Configuration")));
  console.log("═".repeat(60));

  console.log("\n" + bold("Quick Setup:"));
  console.log(dim("\n  1. Configure credentials in ~/.aws/credentials:"));
  console.log(dim("     [default]"));
  console.log(dim("     aws_access_key_id = YOUR_ACCESS_KEY"));
  console.log(dim("     aws_secret_access_key = YOUR_SECRET_KEY"));

  console.log(dim("\n  2. Configure endpoint and region in ~/.aws/config:"));
  console.log(dim("     [default]"));
  console.log(dim(`     region = garage`));
  console.log(dim(`     endpoint_url = ${endpoint}`));
  console.log(dim("     "));
  console.log(dim("     [profile default]"));
  console.log(dim("     s3 ="));
  console.log(dim("         addressing_style = path"));

  console.log(dim("\n  3. Or use this one-liner to configure path-style:"));
  console.log(dim("     aws configure set default.s3.addressing_style path"));

  console.log("\n" + bold("Usage Examples:"));
  console.log(dim("  aws s3 ls                              # List buckets"));
  console.log(dim("  aws s3 mb s3://my-bucket               # Create bucket"));
  console.log(dim("  aws s3 cp file.txt s3://my-bucket/     # Upload file"));
  console.log(dim("  aws s3 sync ./folder s3://my-bucket/   # Sync directory"));

  console.log("\n" + bold("📚 Full Guide:"));
  console.log(dim("  See docs/aws-cli-configuration.md for complete setup"));
  console.log(dim("  instructions, troubleshooting, and advanced usage."));
  console.log("\n");
}
