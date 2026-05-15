# AWS DocuBot — Infrastructure (AWS CDK)

AWS CDK (TypeScript) that provisions the full production infrastructure for DocuBot.

## Stacks

| Stack | Resources | Purpose |
|---|---|---|
| `DocuBotBedrockIamStack` | IAM Role + Policies | Least-privilege Bedrock Titan access |
| `DocuBotBackendStack` | VPC, ECS Fargate, ALB, Secrets Manager | Express + LangGraph backend |
| `DocuBotFrontendStack` | S3, CloudFront | Angular SPA hosting |

## Architecture

```
User
 |
 v
CloudFront (HTTPS)
 |-- /api/*  --> ALB --> ECS Fargate (Express + LangGraph)
 |                              |
 |                        Secrets Manager (API Keys)
 |                              |
 |                        Bedrock Titan (via IAM Role)
 |
 |-- /*      --> S3 (Angular SPA)
```

## Prerequisites

```bash
npm install -g aws-cdk
aws configure
cd infrastructure
npm install
```

## Deploy

```bash
# First time only
cdk bootstrap

# Preview changes
cdk diff

# Deploy all 3 stacks
cdk deploy --all
```

## Tear Down

```bash
cdk destroy --all
```

## Stack Outputs

After deploy, CDK prints:

- `DocuBotFrontendUrl` — CloudFront URL (production app)
- `DocuBotBackendUrl`  — ALB URL (internal API)
- `DocuBotBedrockRoleArn` — IAM Role ARN

## Notes

- API keys (Gemini, Anthropic) are stored in **Secrets Manager** under `docubot/api-keys`.
  Update them after first deploy via AWS Console or CLI.
- Backend Docker image is built from `../backend/` during `cdk deploy`.
- Build Angular before deploying frontend: `cd ../frontend && ng build`.
