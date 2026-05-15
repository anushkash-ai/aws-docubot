#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { BedrockIamStack } from "../lib/bedrock-iam-stack";
import { BackendStack } from "../lib/backend-stack";
import { FrontendStack } from "../lib/frontend-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region:  process.env.CDK_DEFAULT_REGION || "us-east-1",
};

// Stack 1: IAM permissions for Bedrock Titan embeddings
const iamStack = new BedrockIamStack(app, "DocuBotBedrockIamStack", {
  env,
  description: "IAM role with Amazon Bedrock Titan Embeddings access for AWS DocuBot",
});

// Stack 2: ECS Fargate backend (Express + LangGraph)
const backendStack = new BackendStack(app, "DocuBotBackendStack", {
  env,
  description: "ECS Fargate backend for AWS DocuBot Express API",
  bedrockRole: iamStack.bedrockRole,
});
backendStack.addDependency(iamStack);

// Stack 3: S3 + CloudFront frontend (Angular SPA)
const frontendStack = new FrontendStack(app, "DocuBotFrontendStack", {
  env,
  description: "S3 + CloudFront hosting for AWS DocuBot Angular frontend",
  backendUrl: backendStack.backendUrl,
});
frontendStack.addDependency(backendStack);

app.synth();
