import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

interface FrontendStackProps extends cdk.StackProps {
  backendUrl: string;
}

/**
 * FrontendStack
 *
 * Hosts the Angular SPA on S3 + CloudFront.
 *
 * Architecture:
 *   User -> CloudFront (HTTPS, CDN) -> S3 (Angular files)
 *                                   -> ALB (/api/* proxy)
 *
 * Two CloudFront behaviours:
 *   /api/*  -> forwards to the backend ALB (no CORS needed)
 *   /*      -> serves Angular files from S3
 */
export class FrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    // ── S3 Bucket: Angular build output ─────────────────────────────────────
    const siteBucket = new s3.Bucket(this, "DocuBotFrontendBucket", {
      bucketName: `docubot-frontend-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ── Origin Access Control ────────────────────────────────────────────────
    const oac = new cloudfront.S3OriginAccessControl(this, "DocuBotOAC", {
      description: "DocuBot frontend OAC",
      signing: cloudfront.Signing.SIGV4_NO_OVERRIDE,
    });

    // ── Backend ALB Origin ───────────────────────────────────────────────────
    const backendHostname = props.backendUrl.replace("http://", "");
    const backendOrigin = new origins.HttpOrigin(backendHostname, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
    });

    // ── CloudFront Distribution ──────────────────────────────────────────────
    const distribution = new cloudfront.Distribution(this, "DocuBotCDN", {
      comment: "AWS DocuBot - Angular SPA + API proxy",
      defaultRootObject: "index.html",

      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket, {
          originAccessControl: oac,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy:          cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress:             true,
      },

      additionalBehaviors: {
        // Proxy all /api/* requests to the backend ALB
        "/api/*": {
          origin: backendOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy:          cloudfront.CachePolicy.CACHING_DISABLED,
          allowedMethods:       cloudfront.AllowedMethods.ALLOW_ALL,
          originRequestPolicy:  cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },

      // Return index.html for all 403/404 so Angular Router works
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.seconds(0),
        },
      ],
    });

    // Grant CloudFront read access to S3
    siteBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions:    ["s3:GetObject"],
        resources:  [siteBucket.arnForObjects("*")],
        principals: [new iam.ServicePrincipal("cloudfront.amazonaws.com")],
        conditions: {
          StringEquals: {
            "AWS:SourceArn": `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
          },
        },
      })
    );

    // ── Deploy Angular Build to S3 ───────────────────────────────────────────
    // Run `ng build` first, then CDK uploads the build output to S3
    new s3deploy.BucketDeployment(this, "DocuBotDeploy", {
      sources: [s3deploy.Source.asset("../frontend/dist/aws-docubot/browser")],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/*"],
      memoryLimit: 256,
    });

    // ── Outputs ──────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, "CloudFrontUrl", {
      value: `https://${distribution.distributionDomainName}`,
      description: "DocuBot production URL",
      exportName: "DocuBotFrontendUrl",
    });

    new cdk.CfnOutput(this, "S3BucketName", {
      value: siteBucket.bucketName,
      description: "S3 bucket hosting the Angular SPA",
    });
  }
}
