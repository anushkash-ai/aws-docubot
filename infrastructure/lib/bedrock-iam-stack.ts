import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

/**
 * BedrockIamStack
 *
 * Creates an IAM Role that allows the DocuBot backend to call
 * Amazon Bedrock's Titan Embed Text V2 model for generating embeddings.
 *
 * Principle of least privilege: only grants InvokeModel on the
 * specific Titan embedding model — nothing else.
 */
export class BedrockIamStack extends cdk.Stack {
  /** Exported so BackendStack can attach it to the ECS Task Role */
  public readonly bedrockRole: iam.Role;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    // ── IAM Role ────────────────────────────────────────────────────────────
    this.bedrockRole = new iam.Role(this, "DocuBotBedrockRole", {
      roleName: "docubot-bedrock-role",
      // ECS tasks will assume this role
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "Allows DocuBot ECS tasks to invoke Bedrock Titan embeddings",
    });

    // ── Policy: Bedrock Titan Embed Text V2 only ────────────────────────────
    this.bedrockRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "AllowTitanEmbeddings",
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
        ],
      })
    );

    // ── Policy: CloudWatch Logs (for ECS task logging) ──────────────────────
    this.bedrockRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "AllowCloudWatchLogs",
        effect: iam.Effect.ALLOW,
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: ["*"],
      })
    );

    // ── Outputs ─────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, "BedrockRoleArn", {
      value: this.bedrockRole.roleArn,
      description: "IAM Role ARN for Bedrock access",
      exportName: "DocuBotBedrockRoleArn",
    });
  }
}
