import { describe, expect, it } from 'vitest';

import { buildDiagnosticBundle } from '../src/diagnostic-bundle.ts';
import { buildLinearBugReportDraft, submitLinearBugReport } from '../src/linear-bug-intake.ts';
import type {
  LinearIssueCreateInput,
  LinearIssueRef,
  LinearTargets,
  LinearUploadFile,
  SquireLinearClient,
} from '../src/linear-client.ts';

class FakeLinearClient implements SquireLinearClient {
  readonly operations: string[] = [];
  readonly comments: Array<{ issueId: string; body: string }> = [];
  readonly targets: LinearTargets = {
    teamId: 'team-id',
    projectId: 'project-id',
    labelIds: ['bug-label-id'],
    labelName: 'Bug',
    assigneeId: 'me-id',
    stateId: 'todo-id',
  };

  createdInput?: LinearIssueCreateInput;
  uploadInput?: { filename: string; contentType: string; size: number };
  existingIssue?: LinearIssueRef;
  failComments = false;

  async resolveTargets(): Promise<LinearTargets> {
    this.operations.push('resolveTargets');
    return this.targets;
  }

  async findIssueByMarker(_teamKey: string, marker: string): Promise<LinearIssueRef | undefined> {
    this.operations.push('findIssueByMarker');
    expect(marker).toBe('squire-bug:production:conv-1:msg-user-1');
    return this.existingIssue;
  }

  async createIssue(input: LinearIssueCreateInput): Promise<LinearIssueRef> {
    this.operations.push('createIssue');
    this.createdInput = input;
    return {
      id: 'created-id',
      identifier: 'SQR-124',
      url: 'https://linear.app/squire/issue/SQR-124/example',
    };
  }

  async updateIssue(): Promise<LinearIssueRef> {
    throw new Error('updateIssue should not be called');
  }

  async createComment(issueId: string, body: string): Promise<void> {
    this.operations.push('createComment');
    if (this.failComments) throw new Error('Invalid scope: comments:create required');
    this.comments.push({ issueId, body });
  }

  async requestFileUpload(input: {
    filename: string;
    contentType: string;
    size: number;
  }): Promise<LinearUploadFile> {
    this.operations.push('requestFileUpload');
    this.uploadInput = input;
    return {
      uploadUrl: 'https://upload.linear.test/screenshot',
      assetUrl: 'https://uploads.linear.test/squire-bug-test.jpg',
      headers: [{ key: 'x-upload-token', value: 'upload-token' }],
    };
  }
}

function bundle() {
  return buildDiagnosticBundle({
    now: new Date('2026-06-17T12:00:00.000Z'),
    env: {
      SQUIRE_ENV: 'production',
      SENTRY_RELEASE: 'abcdef1234567890',
    },
    route: '/chat/conv-1',
    requestId: 'req-1',
    conversationUrl: 'https://squire.maz.org/chat/conv-1?token=secret',
    browserUrl: 'https://squire.maz.org/chat/conv-1?email=person@example.com',
    conversationId: 'conv-1',
    userMessageId: 'msg-user-1',
    assistantMessageId: 'msg-assistant-1',
    user: { id: 'user-1', email: 'person@example.com' },
    sentryEventUrl: 'https://sentry.io/organizations/maz/issues/123/events/abc/?token=secret',
    langsmithTraceUrl: 'https://smith.langchain.com/o/org/projects/p/project/r/run-1?secret=1',
    browser: {
      url: 'https://squire.maz.org/chat/conv-1?email=person@example.com',
      userAgent: 'SquireTest/1.0 person@example.com',
      viewport: { width: 390, height: 844 },
      replaySnapshotId: 'replay-1',
    },
  });
}

describe('linear bug intake', () => {
  it('builds the SQR-298 dedupe marker and safe Linear body from one diagnostic contract', () => {
    const draft = buildLinearBugReportDraft({
      bundle: bundle(),
      kind: 'wrong_source',
      observed: 'The answer cited the wrong source. Bearer sk_test_secret_secret',
      expected: 'Use the consulted source that actually covers the turn.',
    });

    expect(draft.marker).toBe('squire-bug:production:conv-1:msg-user-1');
    expect(draft.title).toBe('[User submitted bug] Wrong source');
    expect(draft.priority).toBe(2);
    expect(draft.labelName).toBe('Bug');
    expect(draft.description.startsWith('## User Report')).toBe(true);
    expect(draft.description).toContain('Type: Wrong source');
    expect(draft.description).toContain('## Diagnostic Evidence');
    expect(draft.description).toContain('<!-- squire-bug:production:conv-1:msg-user-1 -->');
    expect(draft.diagnosticCommentBody).toContain('## Redacted Diagnostic JSON');
    expect(draft.diagnosticCommentBody).toContain('"schemaVersion": 1');

    const serialized = JSON.stringify(draft);
    expect(serialized).not.toContain('token=secret');
    expect(serialized).not.toContain('person@example.com');
    expect(serialized).not.toContain('sk_test');
  });

  it('returns an existing Linear issue when the dedupe marker is already present', async () => {
    const linearClient = new FakeLinearClient();
    linearClient.existingIssue = {
      id: 'issue-id',
      identifier: 'SQR-123',
      url: 'https://linear.app/squire/issue/SQR-123/example',
    };

    const result = await submitLinearBugReport({
      bundle: bundle(),
      kind: 'bad_answer',
      observed: 'Wrong table answer.',
      expected: 'Correct table answer.',
      linearApiKey: 'lin-test',
      linearClient,
    });

    expect(result.status).toBe('existing');
    if (result.status !== 'existing') throw new Error('expected existing issue');
    expect(result.issue?.identifier).toBe('SQR-123');
    expect(linearClient.operations).toEqual(['resolveTargets', 'findIssueByMarker']);
  });

  it('creates a Linear issue in Squire Bugs and adds the redacted diagnostic payload', async () => {
    const linearClient = new FakeLinearClient();

    const result = await submitLinearBugReport({
      bundle: bundle(),
      kind: 'visual_issue',
      observed: 'The report button overlaps the answer content.',
      expected: 'The action should stay below the answer.',
      linearApiKey: 'lin-test',
      linearClient,
    });

    expect(result.status).toBe('created');
    if (result.status !== 'created') throw new Error('expected created issue');
    expect(result.issue?.identifier).toBe('SQR-124');
    expect(linearClient.createdInput).toMatchObject({
      teamId: 'team-id',
      projectId: 'project-id',
      assigneeId: 'me-id',
      stateId: 'todo-id',
      labelIds: ['bug-label-id'],
      priority: 3,
    });
    expect(linearClient.comments).toHaveLength(1);
    expect(linearClient.comments[0]).toMatchObject({ issueId: 'created-id' });
    expect(linearClient.comments[0]?.body).toContain('Redacted Diagnostic JSON');
    expect(linearClient.operations).toEqual([
      'resolveTargets',
      'findIssueByMarker',
      'createIssue',
      'createComment',
    ]);
  });

  it('uploads an opt-in screenshot attachment after creating the Linear issue', async () => {
    const linearClient = new FakeLinearClient();
    const uploadedBodies: unknown[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url === 'https://upload.linear.test/screenshot') {
        uploadedBodies.push(init?.body);
        return new Response(null, { status: 200 });
      }

      throw new Error(`Unexpected request: ${url}`);
    };

    const result = await submitLinearBugReport({
      bundle: bundle(),
      kind: 'visual_issue',
      observed: 'The answer actions overlap the transcript.',
      expected: 'The actions should stay below the answer.',
      linearApiKey: 'lin-test',
      attachments: [
        {
          filename: 'squire-bug-test.jpg',
          contentType: 'image/jpeg',
          base64Content: 'aGVsbG8=',
          title: 'Conversation UI screenshot',
          subtitle: 'Opt-in screenshot.',
        },
      ],
      fetch,
      linearClient,
    });

    expect(result.status).toBe('created');
    expect(uploadedBodies).toHaveLength(1);
    expect(linearClient.uploadInput).toMatchObject({
      filename: 'squire-bug-test.jpg',
      contentType: 'image/jpeg',
      size: 5,
    });
    expect(linearClient.comments[1]?.body).toContain(
      'https://uploads.linear.test/squire-bug-test.jpg',
    );
    expect(linearClient.operations).toEqual([
      'resolveTargets',
      'findIssueByMarker',
      'createIssue',
      'createComment',
      'requestFileUpload',
      'createComment',
    ]);
  });

  it('still creates the Linear issue when optional comments require extra Linear scope', async () => {
    const linearClient = new FakeLinearClient();
    linearClient.failComments = true;

    const result = await submitLinearBugReport({
      bundle: bundle(),
      kind: 'visual_issue',
      observed: 'The answer actions overlap the transcript.',
      expected: 'The actions should stay below the answer.',
      linearApiKey: 'lin-test',
      attachments: [
        {
          filename: 'squire-bug-test.jpg',
          contentType: 'image/jpeg',
          base64Content: 'aGVsbG8=',
        },
      ],
      fetch: async () => {
        throw new Error('attachment upload should be skipped when comments are unavailable');
      },
      linearClient,
    });

    expect(result.status).toBe('created');
    if (result.status !== 'created') throw new Error('expected created issue');
    expect(result.issue.identifier).toBe('SQR-124');
    expect(result.warnings?.join('\n')).toContain('comments:create required');
    expect(result.warnings?.join('\n')).toContain(
      'skipped because Linear comments are unavailable',
    );
    expect(linearClient.operations).toEqual([
      'resolveTargets',
      'findIssueByMarker',
      'createIssue',
      'createComment',
    ]);
  });

  it('is disabled without a Linear API key', async () => {
    const result = await submitLinearBugReport({
      bundle: bundle(),
      kind: 'bad_answer',
      observed: 'Wrong answer.',
      expected: 'Correct answer.',
      linearApiKey: '',
      fetch: async () => {
        throw new Error('fetch should not be called');
      },
    });

    expect(result).toMatchObject({
      status: 'disabled',
      reason: 'LINEAR_API_KEY is not configured',
    });
  });
});
