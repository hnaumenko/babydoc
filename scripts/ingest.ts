import 'dotenv/config';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { OpenAIEmbeddings } from '@langchain/openai';
import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Document } from '@langchain/core/documents';
import { SOURCE_MAP, SourceMetadata } from '../src/config/sources.js';

// Configuration
const MARKDOWN_DIR = join(process.cwd(), 'data', 'markdown');
const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 300;
const TABLE_NAME = 'medical_knowledge';

// Parse CLI arguments
const FORCE_MODE = process.argv.includes('--force');

/**
 * Sanitizes text by removing problematic Unicode characters.
 */
function sanitizeText(text: string): string {
  return text
    .replace(/\x00/g, '')
    .replace(/[\uD800-\uDFFF]/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}

/**
 * Parse YAML frontmatter from markdown file
 */
function parseFrontmatter(content: string): { metadata: Record<string, any>; body: string } {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { metadata: {}, body: content };
  }

  const [, frontmatter, body] = match;
  const metadata: Record<string, any> = {};

  // Simple YAML parser for key: value pairs
  frontmatter.split('\n').forEach((line) => {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      let value = line.slice(colonIndex + 1).trim();
      // Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // Parse numbers
      if (!isNaN(Number(value)) && value !== '') {
        metadata[key] = Number(value);
      } else {
        metadata[key] = value;
      }
    }
  });

  return { metadata, body };
}

/**
 * Extract section headers from markdown for better chunking context
 */
function extractSectionContext(text: string): string | null {
  // Find the last header before this chunk
  const headerRegex = /^#{1,3}\s+(.+)$/gm;
  const matches = [...text.matchAll(headerRegex)];
  if (matches.length > 0) {
    return matches[matches.length - 1][1];
  }
  return null;
}

/**
 * Validates that all required environment variables are set.
 */
function validateEnv(): void {
  const required = ['OPENAI_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

/**
 * Gets all Markdown files from the markdown directory.
 */
function getMarkdownFiles(): string[] {
  try {
    const files = readdirSync(MARKDOWN_DIR);
    return files.filter((file) => file.toLowerCase().endsWith('.md'));
  } catch (error) {
    console.error(`❌ Cannot read directory: ${MARKDOWN_DIR}`);
    console.log('\n💡 Run the parse script first:');
    console.log('   npx tsx scripts/parse-pdfs.ts <filename>');
    process.exit(1);
  }
}

/**
 * Get source metadata from SOURCE_MAP by matching filename
 */
function getSourceMetadata(mdFilename: string): SourceMetadata | null {
  // Convert .md filename back to .pdf filename
  const pdfFilename = mdFilename.replace('.md', '.pdf');
  return SOURCE_MAP[pdfFilename] || null;
}

/**
 * Checks if a file has already been processed.
 */
async function isFileAlreadyProcessed(
  client: SupabaseClient,
  filename: string
): Promise<boolean> {
  const { count, error } = await client
    .from(TABLE_NAME)
    .select('*', { count: 'exact', head: true })
    .eq('metadata->>filename', filename);

  if (error) {
    console.error(`   ⚠️  Error checking file status: ${error.message}`);
    return false;
  }

  return (count ?? 0) > 0;
}

/**
 * Deletes all existing records for a specific file.
 */
async function deleteFileRecords(
  client: SupabaseClient,
  filename: string
): Promise<number> {
  const { data, error } = await client
    .from(TABLE_NAME)
    .delete()
    .eq('metadata->>filename', filename)
    .select('id');

  if (error) {
    throw new Error(`Failed to delete existing records: ${error.message}`);
  }

  return data?.length ?? 0;
}

/**
 * Processes a single Markdown file: loads, splits, and returns documents with metadata.
 */
async function processMarkdownFile(filename: string): Promise<Document[]> {
  const filePath = join(MARKDOWN_DIR, filename);
  const content = readFileSync(filePath, 'utf-8');

  // Parse frontmatter
  const { metadata: frontmatter, body } = parseFrontmatter(content);
  console.log(`   📋 Frontmatter: ${frontmatter.title || 'No title'}`);

  // Get source metadata from SOURCE_MAP
  const sourceMetadata = getSourceMetadata(filename);
  if (sourceMetadata) {
    console.log(`   📊 Source: ${sourceMetadata.title} (reliability: ${sourceMetadata.reliability}/5)`);
  }

  // Split into chunks using RecursiveCharacterTextSplitter
  // This works well with markdown as it tries to split on paragraph boundaries
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
    separators: ['\n## ', '\n### ', '\n#### ', '\n\n', '\n', ' ', ''],
  });

  const chunks = await splitter.splitText(body);
  console.log(`   Split into ${chunks.length} chunks`);

  // Create documents with rich metadata
  const documents = chunks.map((chunk, index) => {
    const section = extractSectionContext(chunk);
    
    return new Document({
      pageContent: sanitizeText(chunk),
      metadata: {
        // File info
        filename: frontmatter.filename || filename.replace('.md', '.pdf'),
        title: frontmatter.title || sourceMetadata?.title || 'Unknown',
        
        // Source classification (from SOURCE_MAP)
        source_type: sourceMetadata?.type || frontmatter.type || 'unknown',
        reliability: sourceMetadata?.reliability || frontmatter.reliability || 3,
        
        // Age range (critical for filtering)
        age_min_months: sourceMetadata?.age_min ?? frontmatter.age_min_months ?? 0,
        age_max_months: sourceMetadata?.age_max ?? frontmatter.age_max_months ?? 216,
        
        // Language
        language: sourceMetadata?.language || frontmatter.language || 'en',
        
        // Chunk info
        chunk_index: index,
        total_chunks: chunks.length,
        section: section || 'General',
        
        // Timestamps
        parsed_at: frontmatter.parsed_at || new Date().toISOString(),
        ingested_at: new Date().toISOString(),
      },
    });
  });

  return documents;
}

/**
 * Main ingestion function.
 */
async function main() {
  console.log('🚀 Starting Markdown → Vector ingestion...\n');

  if (FORCE_MODE) {
    console.log('⚠️  Force mode enabled: existing records will be replaced\n');
  }

  // Validate environment
  validateEnv();

  // Initialize Supabase client
  const supabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Initialize OpenAI embeddings
  const embeddings = new OpenAIEmbeddings({
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  // Get all Markdown files
  const mdFiles = getMarkdownFiles();
  
  if (mdFiles.length === 0) {
    console.log('❌ No Markdown files found in data/markdown/');
    console.log('\n💡 Run the parse script first:');
    console.log('   npx tsx scripts/parse-pdfs.ts <filename>');
    process.exit(1);
  }

  console.log(`Found ${mdFiles.length} Markdown files to process:`);
  mdFiles.forEach((file) => console.log(`  - ${file}`));

  // Track statistics
  let totalChunks = 0;
  let newFilesProcessed = 0;
  let skippedFiles = 0;
  let failedFiles = 0;

  // Process each file
  for (const filename of mdFiles) {
    try {
      // Get the original PDF filename for database matching
      const pdfFilename = filename.replace('.md', '.pdf');
      console.log(`\n📄 Processing: ${filename}`);

      // Check if file is already processed
      const alreadyProcessed = await isFileAlreadyProcessed(supabaseClient, pdfFilename);

      if (alreadyProcessed && !FORCE_MODE) {
        console.log('   ⏭️  Already processed, skipping (use --force to reprocess)');
        skippedFiles++;
        continue;
      }

      if (alreadyProcessed && FORCE_MODE) {
        const deletedCount = await deleteFileRecords(supabaseClient, pdfFilename);
        console.log(`   🗑️  Deleted ${deletedCount} existing chunks`);
      }

      // Process the file
      const documents = await processMarkdownFile(filename);

      // Store in Supabase vector store
      console.log(`   ⏳ Storing ${documents.length} chunks in Supabase...`);
      await SupabaseVectorStore.fromDocuments(documents, embeddings, {
        client: supabaseClient,
        tableName: TABLE_NAME,
        queryName: 'match_medical_knowledge',
      });

      console.log(`   ✅ Successfully stored ${documents.length} chunks`);
      totalChunks += documents.length;
      newFilesProcessed++;
    } catch (error) {
      failedFiles++;
      console.error(`   ❌ Error processing ${filename}:`);
      if (error instanceof Error) {
        console.error(`      ${error.message}`);
      } else {
        console.error(`      ${String(error)}`);
      }
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 Ingestion Summary:');
  console.log(`   New files processed: ${newFilesProcessed}`);
  console.log(`   Skipped (already in DB): ${skippedFiles}`);
  console.log(`   Failed files: ${failedFiles}`);
  console.log(`   Total chunks stored: ${totalChunks}`);
  console.log('='.repeat(50));

  if (failedFiles > 0) {
    console.log('\n⚠️  Some files failed to process. Check the errors above.');
    process.exit(1);
  }

  console.log('\n✨ Ingestion complete!');
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
