import { BedrockEmbeddings } from "@langchain/aws";
import { config } from "../config";

/**
 * Bedrock Titan Embeddings
 *
 * Converts text into numerical vectors (arrays of numbers).
 * These vectors capture the "meaning" of text — similar texts
 * will have similar vectors. This is how RAG search works.
 *
 * We use Amazon Titan Embeddings V2 through AWS Bedrock.
 */
export const embeddings = new BedrockEmbeddings({
  model: config.embeddingModel,
  region: config.awsRegion,
});
