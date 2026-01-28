/**
 * Tests for Soft Delete and Auto-Delete Functionality
 * Tests the persistent deleted calls feature with restore and analysis exclusion
 */

const path = require('path');
const fs = require('fs');

// Use a test database
const testDbPath = path.join(__dirname, 'test-soft-delete.sqlite');

// Clean up before tests
beforeAll(() => {
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
});

// Clean up after tests
afterAll(() => {
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
});

const transcriptDb = require('../services/transcriptDb');

describe('Soft Delete Feature', () => {
  beforeAll(async () => {
    await transcriptDb.initTranscriptsTable();
  });

  // ========================================
  // Auto-Delete Rules Tests
  // ========================================
  describe('shouldAutoDelete', () => {
    it('should auto-delete titles containing "weekly"', () => {
      expect(transcriptDb.shouldAutoDelete('Weekly Team Sync')).toBe('auto-filter:weekly');
      expect(transcriptDb.shouldAutoDelete('team weekly meeting')).toBe('auto-filter:weekly');
      expect(transcriptDb.shouldAutoDelete('WEEKLY standup')).toBe('auto-filter:weekly');
    });

    it('should auto-delete titles containing "AF ads jour fixe"', () => {
      expect(transcriptDb.shouldAutoDelete('AF ads jour fixe')).toBe('auto-filter:jour-fixe');
      expect(transcriptDb.shouldAutoDelete('Team AF Ads Jour Fixe')).toBe('auto-filter:jour-fixe');
      expect(transcriptDb.shouldAutoDelete('af  ads  jour  fixe')).toBe('auto-filter:jour-fixe'); // extra whitespace
    });

    it('should auto-delete titles that are exactly "dev" (case-insensitive)', () => {
      expect(transcriptDb.shouldAutoDelete('dev')).toBe('auto-filter:dev');
      expect(transcriptDb.shouldAutoDelete('DEV')).toBe('auto-filter:dev');
      expect(transcriptDb.shouldAutoDelete('  dev  ')).toBe('auto-filter:dev'); // with whitespace
    });

    it('should NOT auto-delete titles that contain "dev" but are not exactly "dev"', () => {
      expect(transcriptDb.shouldAutoDelete('dev call')).toBeNull();
      expect(transcriptDb.shouldAutoDelete('dev sync')).toBeNull();
      expect(transcriptDb.shouldAutoDelete('product development meeting')).toBeNull();
      expect(transcriptDb.shouldAutoDelete('dev team standup')).toBeNull();
    });

    it('should auto-delete "development weekly" because it contains weekly', () => {
      // "development weekly" triggers the weekly filter, not the dev filter
      expect(transcriptDb.shouldAutoDelete('development weekly')).toBe('auto-filter:weekly');
    });

    it('should NOT auto-delete regular sales call titles', () => {
      expect(transcriptDb.shouldAutoDelete('Phil and John Smith')).toBeNull();
      expect(transcriptDb.shouldAutoDelete('Demo Call with Acme Corp')).toBeNull();
      expect(transcriptDb.shouldAutoDelete('Sales Discovery - Jane Doe')).toBeNull();
      expect(transcriptDb.shouldAutoDelete('Onboarding Call')).toBeNull();
    });

    it('should handle edge cases', () => {
      expect(transcriptDb.shouldAutoDelete('')).toBeNull();
      expect(transcriptDb.shouldAutoDelete(null)).toBeNull();
      expect(transcriptDb.shouldAutoDelete(undefined)).toBeNull();
    });
  });

  // ========================================
  // Soft Delete and Restore Tests
  // ========================================
  describe('softDeleteTranscript and restoreTranscript', () => {
    const testId = `test-delete-${Date.now()}`;

    beforeAll(async () => {
      // Create a test transcript
      await transcriptDb.saveTranscript({
        fireflies_id: testId,
        call_title: 'Test Sales Call',
        call_datetime: '2025-01-25T10:00:00Z',
        duration_seconds: 1800,
        rep_name: 'Phil',
        transcript_text: 'Test transcript'
      });
    });

    it('should soft delete a transcript with manual reason', async () => {
      const transcript = await transcriptDb.getTranscriptByFirefliesId(testId);
      const result = await transcriptDb.softDeleteTranscript(transcript.id, 'manual');

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(true);

      // Verify it's marked as deleted
      const deleted = await transcriptDb.getTranscriptById(transcript.id);
      expect(deleted.deleted_at).not.toBeNull();
      expect(deleted.deleted_reason).toBe('manual');
    });

    it('should exclude deleted transcript from getRecentTranscripts', async () => {
      const transcripts = await transcriptDb.getRecentTranscripts(100, 0, {});
      const ids = transcripts.map(t => t.fireflies_id);
      expect(ids).not.toContain(testId);
    });

    it('should include deleted transcript in getDeletedTranscripts', async () => {
      const deletedTranscripts = await transcriptDb.getDeletedTranscripts(100, 0, {});
      const ids = deletedTranscripts.map(t => t.fireflies_id);
      expect(ids).toContain(testId);
    });

    it('should restore a deleted transcript', async () => {
      const transcript = await transcriptDb.getTranscriptByFirefliesId(testId);
      const result = await transcriptDb.restoreTranscript(transcript.id);

      expect(result.success).toBe(true);
      expect(result.restored).toBe(true);

      // Verify it's no longer deleted
      const restored = await transcriptDb.getTranscriptById(transcript.id);
      expect(restored.deleted_at).toBeNull();
      expect(restored.deleted_reason).toBeNull();
    });

    it('should include restored transcript in getRecentTranscripts', async () => {
      // Fetch the transcript directly to verify it's not deleted
      const transcript = await transcriptDb.getTranscriptByFirefliesId(testId);
      expect(transcript).not.toBeNull();
      expect(transcript.deleted_at).toBeNull();

      // Also verify it's in the recent transcripts list
      const transcripts = await transcriptDb.getRecentTranscripts(500, 0, {});
      const found = transcripts.find(t => t.fireflies_id === testId);
      expect(found).toBeDefined();
    });

    it('should return error when restoring non-deleted transcript', async () => {
      const transcript = await transcriptDb.getTranscriptByFirefliesId(testId);
      const result = await transcriptDb.restoreTranscript(transcript.id);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Transcript is not deleted');
    });

    it('should return error when transcript not found', async () => {
      const result = await transcriptDb.softDeleteTranscript('non-existent-id');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Transcript not found');
    });
  });

  // ========================================
  // Auto-Delete on Sync Tests
  // ========================================
  describe('saveTranscript auto-delete behavior', () => {
    it('should auto-delete new transcript with weekly in title', async () => {
      const result = await transcriptDb.saveTranscript({
        fireflies_id: `auto-delete-weekly-${Date.now()}`,
        call_title: 'Weekly Team Sync',
        call_datetime: '2025-01-25T10:00:00Z',
        duration_seconds: 1800,
        rep_name: 'Phil',
        transcript_text: 'Test'
      });

      expect(result.autoDeleted).toBe(true);
      expect(result.deleted_reason).toBe('auto-filter:weekly');
    });

    it('should auto-delete new transcript with jour fixe in title', async () => {
      const result = await transcriptDb.saveTranscript({
        fireflies_id: `auto-delete-jourfixe-${Date.now()}`,
        call_title: 'AF ads jour fixe',
        call_datetime: '2025-01-25T10:00:00Z',
        duration_seconds: 1800,
        rep_name: 'Phil',
        transcript_text: 'Test'
      });

      expect(result.autoDeleted).toBe(true);
      expect(result.deleted_reason).toBe('auto-filter:jour-fixe');
    });

    it('should auto-delete new transcript with exactly "dev" as title', async () => {
      const result = await transcriptDb.saveTranscript({
        fireflies_id: `auto-delete-dev-${Date.now()}`,
        call_title: 'dev',
        call_datetime: '2025-01-25T10:00:00Z',
        duration_seconds: 1800,
        rep_name: 'Phil',
        transcript_text: 'Test'
      });

      expect(result.autoDeleted).toBe(true);
      expect(result.deleted_reason).toBe('auto-filter:dev');
    });

    it('should NOT auto-delete transcript with "dev call" title', async () => {
      const result = await transcriptDb.saveTranscript({
        fireflies_id: `no-auto-delete-devcall-${Date.now()}`,
        call_title: 'dev call',
        call_datetime: '2025-01-25T10:00:00Z',
        duration_seconds: 1800,
        rep_name: 'Phil',
        transcript_text: 'Test'
      });

      expect(result.autoDeleted).toBeFalsy();
      expect(result.deleted_reason).toBeNull();
    });

    it('should NOT auto-delete regular sales call', async () => {
      const result = await transcriptDb.saveTranscript({
        fireflies_id: `no-auto-delete-sales-${Date.now()}`,
        call_title: 'Phil and Jane Smith',
        call_datetime: '2025-01-25T10:00:00Z',
        duration_seconds: 1800,
        rep_name: 'Phil',
        transcript_text: 'Test'
      });

      expect(result.autoDeleted).toBeFalsy();
    });
  });

  // ========================================
  // Deleted State Persistence Tests
  // ========================================
  describe('deleted state persistence on re-sync', () => {
    const persistenceId = `persistence-test-${Date.now()}`;

    it('should preserve deleted state on re-sync', async () => {
      // Step 1: Create a transcript
      await transcriptDb.saveTranscript({
        fireflies_id: persistenceId,
        call_title: 'Sales Call with Acme',
        call_datetime: '2025-01-25T10:00:00Z',
        duration_seconds: 1800,
        rep_name: 'Phil',
        transcript_text: 'Test'
      });

      // Step 2: Soft delete it
      const transcript = await transcriptDb.getTranscriptByFirefliesId(persistenceId);
      await transcriptDb.softDeleteTranscript(transcript.id, 'manual');

      // Step 3: Re-sync (save again with same fireflies_id)
      const result = await transcriptDb.saveTranscript({
        fireflies_id: persistenceId,
        call_title: 'Sales Call with Acme - Updated',
        call_datetime: '2025-01-25T10:00:00Z',
        duration_seconds: 1900,
        rep_name: 'Phil',
        transcript_text: 'Updated transcript'
      });

      // Verify: Should still be deleted
      expect(result.wasAlreadyDeleted).toBe(true);
      expect(result.deleted_at).not.toBeNull();

      // Double-check with fresh fetch
      const updatedTranscript = await transcriptDb.getTranscriptById(transcript.id);
      expect(updatedTranscript.deleted_at).not.toBeNull();
      expect(updatedTranscript.deleted_reason).toBe('manual');
    });
  });

  // ========================================
  // Analysis Exclusion Tests
  // ========================================
  describe('getTranscriptsNeedingAnalysis excludes deleted', () => {
    const analysisTestId = `analysis-test-${Date.now()}`;

    beforeAll(async () => {
      // Create and delete a transcript that would normally need analysis
      await transcriptDb.saveTranscript({
        fireflies_id: analysisTestId,
        call_title: 'Call Needing Analysis',
        call_datetime: '2025-01-25T10:00:00Z',
        duration_seconds: 1800,
        rep_name: 'Phil',
        transcript_text: 'This is a sales transcript that needs analysis'
      });

      const transcript = await transcriptDb.getTranscriptByFirefliesId(analysisTestId);
      await transcriptDb.softDeleteTranscript(transcript.id, 'manual');
    });

    it('should not include deleted transcript in analysis queue', async () => {
      const needingAnalysis = await transcriptDb.getTranscriptsNeedingAnalysis(100, 1);
      const ids = needingAnalysis.map(t => t.fireflies_id);
      expect(ids).not.toContain(analysisTestId);
    });
  });

  // ========================================
  // Bulk Soft Delete Tests
  // ========================================
  describe('softDeleteTranscripts (bulk)', () => {
    const bulkIds = [];

    beforeAll(async () => {
      // Create multiple transcripts for bulk delete
      for (let i = 0; i < 3; i++) {
        const id = `bulk-delete-${Date.now()}-${i}`;
        bulkIds.push(id);
        await transcriptDb.saveTranscript({
          fireflies_id: id,
          call_title: `Bulk Delete Test ${i}`,
          call_datetime: '2025-01-25T10:00:00Z',
          duration_seconds: 1800,
          rep_name: 'Phil',
          transcript_text: 'Test'
        });
      }
    });

    it('should soft delete multiple transcripts', async () => {
      // Get internal IDs
      const internalIds = [];
      for (const ffId of bulkIds) {
        const t = await transcriptDb.getTranscriptByFirefliesId(ffId);
        internalIds.push(t.id);
      }

      const result = await transcriptDb.softDeleteTranscripts(internalIds, 'manual');

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(3);
      expect(result.errors).toHaveLength(0);

      // Verify all are deleted
      for (const ffId of bulkIds) {
        const t = await transcriptDb.getTranscriptByFirefliesId(ffId);
        expect(t.deleted_at).not.toBeNull();
      }
    });

    it('should return error for empty array', async () => {
      const result = await transcriptDb.softDeleteTranscripts([]);
      expect(result.success).toBe(false);
      expect(result.errors[0]).toBe('No transcript IDs provided');
    });
  });
});
