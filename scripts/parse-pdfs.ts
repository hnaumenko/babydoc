import 'dotenv/config';
import { LlamaParseReader } from 'llamaindex';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { SOURCE_MAP, SourceMetadata } from '../src/config/sources.js';


// Configuration
const RAW_DATA_DIR = join(process.cwd(), 'data', 'raw');
const MARKDOWN_DIR = join(process.cwd(), 'data', 'markdown');

/**
 * Validate environment variables
 */
function validateEnv(): void {
  if (!process.env.LLAMA_CLOUD_API_KEY) {
    console.error('❌ Missing LLAMA_CLOUD_API_KEY in .env');
    console.log('\n📝 Get your free API key at: https://cloud.llamaindex.ai/');
    process.exit(1);
  }
}

/**
 * Parse a single PDF file using LlamaParse
 */
async function parsePdf(filename: string, metadata: SourceMetadata): Promise<void> {
  const inputPath = join(RAW_DATA_DIR, filename);
  const outputFilename = filename.replace('.pdf', '.md');
  const outputPath = join(MARKDOWN_DIR, outputFilename);

  console.log(`\n📄 Parsing: ${metadata.title}`);
  console.log(`   Input: ${filename}`);
  console.log(`   Output: ${outputFilename}`);

  try {
    // Initialize LlamaParse reader
    const reader = new LlamaParseReader({
      resultType: 'markdown',
      language: metadata.language as any, // Type assertion for LlamaParse enum
      // Preserve table structure - critical for medical dosages
      parsingInstruction: `
You are parsing a PEDIATRIC MEDICAL BOOK. Accuracy is critical for child safety.

## PRESERVE EXACTLY (never summarize or round):
- **Dosages**: "2.5 ml" NOT "about 2-3 ml", "15-20 minutes" NOT "some time"
- **Age ranges**: "0-3 months", "under 6 months", "2-5 years"
- **Weight-based dosing**: "10-15 mg/kg", "1 drop per 10 lbs"
- **Frequencies**: "every 4-6 hours", "no more than 3 times daily"
- **Temperatures**: "100.4°F (38°C)", "above 104°F"

## FORMAT AS MARKDOWN:
- **Tables**: Use | pipes | for dosage tables, growth charts, milestone tables
- **Warning boxes**: Format as blockquote with ⚠️ WARNING: prefix
- **Red flags / When to call doctor**: Format as blockquote with 🚨 SEEK IMMEDIATE CARE:
- **Step-by-step instructions**: Use numbered lists (1. 2. 3.)
- **Symptoms lists**: Use bullet points (- or •)
- **Headers**: Preserve hierarchy (# Chapter, ## Section, ### Subsection)

## SPECIAL ATTENTION TO:
- Developmental milestones by age (rolling, sitting, walking)
- Feeding schedules and amounts by age
- Sleep recommendations by age
- Vaccination schedules
- Growth percentiles
- Medication contraindications ("NEVER give aspirin to children")
- Emergency signs (breathing difficulty, dehydration signs)
- Anatomical descriptions and techniques (how to use bulb syringe, how to check temperature)

## DO NOT:
- Combine separate warnings into one paragraph
- Change units (keep both °F and °C if present)
- Skip footnotes or small print (often contains critical safety info)
- Merge columns in tables
- Summarize lists of symptoms - include ALL items
      `,
    });

    // Parse the PDF
    console.log('   ⏳ Parsing with LlamaParse (this may take a few minutes)...');
    const documents = await reader.loadData(inputPath);

    // Combine all pages into one markdown file
    const markdownContent = documents
      .map((doc, index) => {
        // Add page marker for debugging
        return `<!-- Page ${index + 1} -->\n\n${doc.text}`;
      })
      .join('\n\n---\n\n');

    // Add metadata header
    const header = `---
title: "${metadata.title}"
filename: "${metadata.filename}"
type: "${metadata.type}"
reliability: ${metadata.reliability}
age_min_months: ${metadata.age_min}
age_max_months: ${metadata.age_max}
language: "${metadata.language}"
parsed_at: "${new Date().toISOString()}"
---

`;

    // Write to file
    writeFileSync(outputPath, header + markdownContent, 'utf-8');

    console.log(`   ✅ Successfully parsed! ${documents.length} pages`);
    console.log(`   📁 Saved to: ${outputPath}`);
  } catch (error) {
    console.error(`   ❌ Error parsing ${filename}:`);
    if (error instanceof Error) {
      console.error(`      ${error.message}`);
    }
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 LlamaParse PDF → Markdown Converter\n');

  // Validate environment
  validateEnv();

  // Ensure output directory exists
  if (!existsSync(MARKDOWN_DIR)) {
    mkdirSync(MARKDOWN_DIR, { recursive: true });
    console.log(`📁 Created directory: ${MARKDOWN_DIR}`);
  }

  // Get command line argument for specific file
  const targetFile = process.argv[2];

  if (targetFile === '--all') {
    // Parse all files
    console.log('📚 Parsing ALL PDF files...\n');
    console.log('⚠️  Warning: This may exceed the free tier limit (1000 pages/day)');
    console.log('   Consider parsing one book per day.\n');

    for (const [filename, metadata] of Object.entries(SOURCE_MAP)) {
      try {
        await parsePdf(filename, metadata);
      } catch (error) {
        console.error(`   Skipping ${filename} due to error`);
      }
    }
  } else if (targetFile) {
    // Parse specific file
    const metadata = SOURCE_MAP[targetFile];
    if (!metadata) {
      console.error(`❌ File not found in SOURCE_MAP: ${targetFile}`);
      console.log('\n📋 Available files:');
      Object.keys(SOURCE_MAP).forEach((f) => console.log(`   - ${f}`));
      process.exit(1);
    }

    await parsePdf(targetFile, metadata);
  } else {
    // Show help
    console.log('Usage:');
    console.log('  npx tsx scripts/parse-pdfs.ts <filename>   # Parse one file');
    console.log('  npx tsx scripts/parse-pdfs.ts --all        # Parse all files');
    console.log('\n📋 Available files (from src/config/sources.ts):');
    
    for (const [filename, metadata] of Object.entries(SOURCE_MAP)) {
      const ageRange = `${metadata.age_min}-${metadata.age_max} months`;
      console.log(`\n  📖 ${metadata.title}`);
      console.log(`     File: ${filename}`);
      console.log(`     Type: ${metadata.type} | Reliability: ${metadata.reliability}/5 | Age: ${ageRange}`);
    }

    console.log('\n💡 Tip: Start with the AAP book (free tier: 1000 pages/day):');
    console.log('   npx tsx scripts/parse-pdfs.ts "caring-for-your-baby-and-young-child-birth-to-age-5_compress.pdf"');
  }

  console.log('\n✨ Done!');
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
