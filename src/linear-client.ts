import { LinearClient } from '@linear/sdk';

export interface LinearIssueRef {
  id: string;
  identifier: string;
  url: string;
}

export interface LinearTargetInput {
  teamKey: string;
  projectName?: string;
  labelName: string;
  stateName?: string;
  assignViewer?: boolean;
}

export interface LinearTargets {
  teamId: string;
  projectId?: string;
  labelIds: string[];
  labelName: string;
  assigneeId?: string;
  stateId?: string;
}

export interface LinearUploadFile {
  uploadUrl: string;
  assetUrl: string;
  headers: { key: string; value: string }[];
}

export interface LinearIssueCreateInput {
  teamId: string;
  title: string;
  description?: string;
  priority?: number;
  projectId?: string;
  assigneeId?: string;
  stateId?: string;
  labelIds?: string[];
}

export interface LinearIssueUpdateInput {
  title?: string;
  description?: string;
  priority?: number;
  projectId?: string;
  labelIds?: string[];
}

export interface SquireLinearClient {
  resolveTargets(input: LinearTargetInput): Promise<LinearTargets>;
  findIssueByMarker(teamKey: string, marker: string): Promise<LinearIssueRef | undefined>;
  createIssue(input: LinearIssueCreateInput): Promise<LinearIssueRef>;
  updateIssue(id: string, input: LinearIssueUpdateInput): Promise<LinearIssueRef>;
  createComment(issueId: string, body: string): Promise<void>;
  requestFileUpload(input: {
    filename: string;
    contentType: string;
    size: number;
  }): Promise<LinearUploadFile>;
}

interface LinearSdkRecord {
  id?: unknown;
  key?: unknown;
  name?: unknown;
  identifier?: unknown;
  url?: unknown;
  team?: { id?: unknown; key?: unknown } | null;
}

interface LinearSdkConnection<T extends LinearSdkRecord> {
  nodes?: T[];
}

interface LinearSdkIssuePayload {
  success?: unknown;
  issue?: LinearSdkRecord | PromiseLike<LinearSdkRecord | undefined> | undefined;
}

interface LinearSdkCommentPayload {
  success?: unknown;
}

interface LinearSdkUploadPayload {
  success?: unknown;
  uploadFile?: LinearUploadFile | null;
}

interface LinearSdkClient {
  viewer: PromiseLike<{ id?: unknown }>;
  teams(variables?: unknown): PromiseLike<LinearSdkConnection<LinearSdkRecord>>;
  projects(variables?: unknown): PromiseLike<LinearSdkConnection<LinearSdkRecord>>;
  issueLabels(variables?: unknown): PromiseLike<LinearSdkConnection<LinearSdkRecord>>;
  workflowStates(variables?: unknown): PromiseLike<LinearSdkConnection<LinearSdkRecord>>;
  issues(variables?: unknown): PromiseLike<LinearSdkConnection<LinearSdkRecord>>;
  issue(id: string): PromiseLike<LinearSdkRecord>;
  createIssue(input: Record<string, unknown>): PromiseLike<LinearSdkIssuePayload>;
  updateIssue(id: string, input: Record<string, unknown>): PromiseLike<LinearSdkIssuePayload>;
  createComment(input: { issueId: string; body: string }): PromiseLike<LinearSdkCommentPayload>;
  fileUpload(
    contentType: string,
    filename: string,
    size: number,
  ): PromiseLike<LinearSdkUploadPayload>;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function issueRef(record: LinearSdkRecord | undefined, context: string): LinearIssueRef {
  const id = stringField(record?.id);
  const identifier = stringField(record?.identifier);
  const url = stringField(record?.url);
  if (!id || !identifier || !url) {
    throw new Error(`Linear ${context} did not include id, identifier, and url`);
  }
  return { id, identifier, url };
}

async function maybeAwait<T>(value: T | PromiseLike<T> | undefined): Promise<T | undefined> {
  return value === undefined ? undefined : await value;
}

function recordId(record: LinearSdkRecord | undefined): string | undefined {
  return stringField(record?.id);
}

export function createLinearClient(apiKey: string): SquireLinearClient {
  return new LinearSdkIssueClient(apiKey);
}

class LinearSdkIssueClient implements SquireLinearClient {
  private readonly sdk: LinearSdkClient;

  constructor(apiKey: string) {
    this.sdk = new LinearClient({ apiKey }) as unknown as LinearSdkClient;
  }

  async resolveTargets(input: LinearTargetInput): Promise<LinearTargets> {
    const [teams, projects, labels, states, viewer] = await Promise.all([
      this.sdk.teams({ first: 1, filter: { key: { eq: input.teamKey } } }),
      input.projectName
        ? this.sdk.projects({
            first: 1,
            filter: {
              name: { eq: input.projectName },
              accessibleTeams: { some: { key: { eq: input.teamKey } } },
            },
          })
        : Promise.resolve({ nodes: [] }),
      this.sdk.issueLabels({
        first: 10,
        filter: {
          name: { eqIgnoreCase: input.labelName },
          or: [{ team: { null: true } }, { team: { key: { eq: input.teamKey } } }],
        },
      }),
      input.stateName
        ? this.sdk.workflowStates({
            first: 1,
            filter: {
              team: { key: { eq: input.teamKey } },
              name: { eqIgnoreCase: input.stateName },
            },
          })
        : Promise.resolve({ nodes: [] }),
      input.assignViewer ? this.sdk.viewer : Promise.resolve(undefined),
    ]);

    const team = teams.nodes?.[0];
    const teamId = stringField(team?.id);
    if (!teamId) throw new Error(`Linear team ${input.teamKey} was not found`);

    const project = projects.nodes?.[0];
    const projectId = stringField(project?.id);
    if (input.projectName && !projectId) {
      throw new Error(`Linear project ${input.projectName} was not found`);
    }

    const label = labels.nodes?.find((candidate) => candidate.team === null) ?? labels.nodes?.[0];
    const labelId = stringField(label?.id);
    const labelName = stringField(label?.name);
    if (!labelId || !labelName) throw new Error(`Linear label ${input.labelName} was not found`);

    const state = states.nodes?.[0];
    const stateId = input.stateName ? stringField(state?.id) : undefined;
    if (input.stateName && !stateId) {
      throw new Error(`Linear state ${input.stateName} was not found`);
    }

    const assigneeId = input.assignViewer ? stringField(viewer?.id) : undefined;
    if (input.assignViewer && !assigneeId) throw new Error('Linear viewer id was not returned');

    return {
      teamId,
      ...(projectId ? { projectId } : {}),
      labelIds: [labelId],
      labelName,
      ...(stateId ? { stateId } : {}),
      ...(assigneeId ? { assigneeId } : {}),
    };
  }

  async findIssueByMarker(teamKey: string, marker: string): Promise<LinearIssueRef | undefined> {
    const issues = await this.sdk.issues({
      first: 1,
      filter: {
        team: { key: { eq: teamKey } },
        description: { contains: marker },
      },
    });
    const issue = issues.nodes?.[0];
    return issue ? issueRef(issue, 'issue search result') : undefined;
  }

  async createIssue(input: LinearIssueCreateInput): Promise<LinearIssueRef> {
    const payload = await this.sdk.createIssue({ ...input });
    if (payload.success !== true) throw new Error('Linear issueCreate returned success=false');
    return this.issueFromPayload(payload, 'created issue');
  }

  async updateIssue(id: string, input: LinearIssueUpdateInput): Promise<LinearIssueRef> {
    const payload = await this.sdk.updateIssue(id, { ...input });
    if (payload.success !== true) {
      throw new Error(`Linear issueUpdate returned success=false for ${id}`);
    }
    return this.issueFromPayload(payload, 'updated issue');
  }

  async createComment(issueId: string, body: string): Promise<void> {
    const payload = await this.sdk.createComment({ issueId, body });
    if (payload.success !== true) {
      throw new Error(`Linear commentCreate returned success=false for issue ${issueId}`);
    }
  }

  async requestFileUpload(input: {
    filename: string;
    contentType: string;
    size: number;
  }): Promise<LinearUploadFile> {
    const payload = await this.sdk.fileUpload(input.contentType, input.filename, input.size);
    if (payload.success !== true || !payload.uploadFile) {
      throw new Error(`Linear fileUpload returned success=false for ${input.filename}`);
    }
    return payload.uploadFile;
  }

  private async issueFromPayload(
    payload: LinearSdkIssuePayload,
    context: string,
  ): Promise<LinearIssueRef> {
    const issue = await maybeAwait(payload.issue);
    const id = recordId(issue);
    if (issue && stringField(issue.identifier) && stringField(issue.url)) {
      return issueRef(issue, context);
    }
    if (id) {
      return issueRef(await this.sdk.issue(id), context);
    }
    throw new Error(`Linear ${context} payload did not include an issue`);
  }
}
