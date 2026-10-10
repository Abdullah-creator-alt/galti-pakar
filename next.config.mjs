/**
 * The pipeline's runtime data files (topics, generic bank, genericness model, benchmark) are imported statically in
 * lib/pipeline/dataFiles.ts and benchmark.ts, so the bundler copies them into the serverless functions and a missing
 * file fails the build. They are NOT read with fs at run time: Next's file tracing cannot follow a dynamic path, and
 * it would ship the whole data/ folder (caches and training sets included).
 * `npm run verify:bundle` (after a build) checks that the data really is inside the API route bundles.
 * sharp, the one native dependency, is on Next's default list of external packages and has prebuilt Linux binaries.
 *
 * @type {import('next').NextConfig}
 */
export default {};
