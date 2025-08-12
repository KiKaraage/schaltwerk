
⏺ Performance Regression in list_enriched_sessions Caching

  Test Failure: para_core::tests::test_list_enriched_sessions_performance_caching

  Issue: The warm cache performance test is failing - the cached call is taking longer than the cold call, indicating the caching
  mechanism may not be working properly.

  Test Results:
  - Cold run (no cache): 153.917µs
  - Warm run (with cache): 261.208µs
  - Expected: Warm should be ≤ 1.1x cold (~169µs max)

  Location: src-tauri/src/para_core/tests.rs:425

  What the test does: Creates 8 sessions, calls list_enriched_sessions() twice, and expects the second cached call to be faster than the
  first uncached call.

  Potential causes:
  1. Database caching logic not working correctly
  2. Cache invalidation happening between calls
  3. Git stats computation still occurring on warm call
  4. Database lock contention

  Note: This is unrelated to the recent diff viewer UI changes but needs investigation to ensure session listing performance remains
  optimal.
