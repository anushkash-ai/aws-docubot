import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

interface BackendStackProps extends cdk.StackProps {
  bedrockRole: iam.Role;
}

/**
 * BackendStack
 *
 * Deploys the Express + LangGraph backend as an ECS Fargate service
 * behind an Application Load Balancer.
 *
 * Architecture:
 *   Internet -> ALB (port 80) -> Fargate Task (port 3000)
 *
 * The Fargate task uses the BedrockRole to call Titan embeddings.
 * API keys (Gemini, Anthropic) are stored in Secrets Manager.
 */
export class BackendStack extends cdk.Stack {
  /** ALB DNS - passed to FrontendStack as the API base URL */
  public readonly backendUrl: string;

  constructor(scope: Construct, id: string, props: BackendStackProps) {
    super(scope, id, props);

    // ── VPC ─────────────────────────────────────────────────────────────────
    // 2 AZs, 1 public + 1 private subnet each - standard HA setup
    const vpc = new ec2.Vpc(this, "DocuBotVpc", {
      vpcName: "docubot-vpc",
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    // ── Secrets Manager: API Keys ────────────────────────────────────────────
    // Store sensitive keys outside environment variables
    const apiSecrets = new secretsmanager.Secret(this, "DocuBotApiSecrets", {
      secretName: "docubot/api-keys",
      description: "API keys for DocuBot LLM providers",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          GOOGLE_API_KEY:    "REPLACE_ME",
          ANTHROPIC_API_KEY: "REPLACE_ME",
          AWS_REGION:        "us-east-1",
        }),
        generateStringKey: "_unused",
      },
    });

    // ── ECS Cluster ─────────────────────────────────────────────────────────
    const cluster = new ecs.Cluster(this, "DocuBotCluster", {
      clusterName: "docubot-cluster",
      vpc,
      containerInsights: true,
    });

    // ── CloudWatch Log Group ─────────────────────────────────────────────────
    const logGroup = new logs.LogGroup(this, "DocuBotBackendLogs", {
      logGroupName: "/docubot/backend",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── Fargate Task Definition ──────────────────────────────────────────────
    const taskDef = new ecs.FargateTaskDefinition(this, "DocuBotTaskDef", {
      family: "docubot-backend",
      memoryLimitMiB: 1024,
      cpu: 512,
      taskRole: props.bedrockRole,
    });

    // Main container - built from backend/ Dockerfile
    taskDef.addContainer("BackendContainer", {
      image: ecs.ContainerImage.fromAsset("../backend"),
      containerName: "docubot-backend",
      portMappings: [{ containerPort: 3000 }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "backend",
        logGroup,
      }),
      environment: {
        PORT:       "3000",
        AWS_REGION: this.region,
        NODE_ENV:   "production",
      },
      secrets: {
        GOOGLE_API_KEY:    ecs.Secret.fromSecretsManager(apiSecrets, "GOOGLE_API_KEY"),
        ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(apiSecrets, "ANTHROPIC_API_KEY"),
      },
      healthCheck: {
        command: ["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"],
        interval: cdk.Duration.seconds(30),
        timeout:  cdk.Duration.seconds(5),
        retries:  3,
      },
    });

    // ── ALB Fargate Service ──────────────────────────────────────────────────
    const fargateService = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      "DocuBotFargateService",
      {
        serviceName:      "docubot-backend",
        cluster,
        taskDefinition:   taskDef,
        desiredCount:     1,
        publicLoadBalancer: true,
        listenerPort:     80,
        assignPublicIp:   false,
        circuitBreaker:   { rollback: true },
      }
    );

    // Allow outbound HTTPS to LLM APIs (Gemini, Anthropic, Bedrock)
    fargateService.service.connections.allowToAnyIpv4(
      ec2.Port.tcp(443),
      "Allow HTTPS outbound to LLM APIs"
    );

    // ── Auto Scaling ─────────────────────────────────────────────────────────
    const scaling = fargateService.service.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 3,
    });
    scaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: 70,
      scaleInCooldown:  cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // ── Outputs ──────────────────────────────────────────────────────────────
    this.backendUrl = `http://${fargateService.loadBalancer.loadBalancerDnsName}`;

    new cdk.CfnOutput(this, "BackendUrl", {
      value: this.backendUrl,
      description: "ALB URL for the DocuBot backend API",
      exportName: "DocuBotBackendUrl",
    });

    new cdk.CfnOutput(this, "EcsClusterName", {
      value: cluster.clusterName,
      description: "ECS Cluster name",
    });

    new cdk.CfnOutput(this, "SecretsManagerArn", {
      value: apiSecrets.secretArn,
      description: "Update API keys here after deploy",
    });
  }
}
