import { packagedResources } from './packaged-paths.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MediaRenderer, resolveMediaRuntimePaths } from '../../src-electron/media-runtime.ts';

test('the real checkpoint writer rejects skipped approval and missing predecessors', async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'openmontage-checkpoint-test-'));
  const renderer = new MediaRenderer(resolveMediaRuntimePaths({ appRoot: process.cwd(), scratchRoot: scratch, packaged: true, resourcesPath: packagedResources(process.cwd()) }));
  const input = { pipelineId: 'nimi-image-explainer', projectId: 'checkpoint-contract-test', title: 'Checkpoint validation fixture', stage: 'scene_plan', status: 'completed', artifacts: {}, humanApproved: false, checkpoints: {} };
  try {
    await assert.rejects(renderer.checkpoint(input), /GATE VIOLATION/);
    await assert.rejects(renderer.checkpoint({ ...input, stage: 'compose' }), /PREREQUISITE VIOLATION/);
    const scenePlan = { version: '1.0', scenes: [0, 1, 2].map(index => ({ id: String(index), type: 'generated', description: 'Schema fixture only', start_seconds: index * 10, end_seconds: (index + 1) * 10 })) };
    const waiting = await renderer.checkpoint({ ...input, status: 'awaiting_human', artifacts: { scene_plan: scenePlan } });
    assert.equal(waiting.human_approved, false);
    const approved = await renderer.checkpoint({ ...input, artifacts: { scene_plan: scenePlan }, humanApproved: true, checkpoints: { scene_plan: waiting } });
    assert.equal(approved.status, 'completed');
    assert.equal(approved.human_approved, true);

    const concept = (id, structure) => ({ id, title: `Concept ${id}`, hook: 'Short hook', narrative_structure: structure, visual_approach: 'Clean visual', target_duration_seconds: 30, why_this_works: 'Grounded' });
    const researchBrief = {
      version: '1.0',
      topic: 'Water cycle',
      research_date: '2026-11-21',
      landscape: { existing_content: [1, 2, 3].map(i => ({ title: `T${i}`, source: 'blog', angle: 'overview', what_it_covers: 'basics' })), saturated_angles: ['generic'], underserved_gaps: ['phase transitions'] },
      data_points: [1, 2, 3].map(i => ({ claim: `Claim ${i}`, source_url: `https://example.com/${i}`, credibility: 'primary_source' })),
      audience_insights: { common_questions: ['Q1', 'Q2', 'Q3'], misconceptions: [], knowledge_level: 'beginner' },
      angles_discovered: [1, 2, 3].map(i => ({ name: `Angle ${i}`, hook: 'Hook', type: 'evergreen', why_now: 'Relevant' })),
      sources: [1, 2, 3, 4, 5].map(i => ({ url: `https://example.com/s${i}`, title: `S${i}`, used_for: 'landscape' })),
    };
    const pendingProposal = {
      version: '1.0',
      concept_options: [concept('c1', 'story'), concept('c2', 'timeline'), concept('c3', 'analogy')],
      selected_concept: { concept_id: 'c1', rationale: 'Best fit' },
      production_plan: { pipeline: 'animated-explainer', stages: [{ stage: 'proposal', tools: [], approach: 'Plan stages' }] },
      cost_estimate: { total_estimated_usd: 0, line_items: [], budget_verdict: 'no_budget_set' },
      approval: { status: 'pending' },
    };
    const proposalBase = { pipelineId: 'animated-explainer', projectId: 'proposal-approval-test', title: 'Proposal validation fixture' };
    const researchDone = await renderer.checkpoint({ ...proposalBase, stage: 'research', status: 'completed', artifacts: { research_brief: researchBrief }, humanApproved: false, checkpoints: {} });
    const proposalWaiting = await renderer.checkpoint({ ...proposalBase, stage: 'proposal', status: 'awaiting_human', artifacts: { proposal_packet: pendingProposal }, humanApproved: false, checkpoints: { research: researchDone } });
    assert.equal(proposalWaiting.status, 'awaiting_human');
    await assert.rejects(renderer.checkpoint({ ...proposalBase, stage: 'proposal', status: 'completed', artifacts: { proposal_packet: pendingProposal }, humanApproved: true, checkpoints: { research: researchDone, proposal: proposalWaiting } }), /approved/);
    const approvedProposal = { ...pendingProposal, production_plan: { ...pendingProposal.production_plan, render_runtime: 'remotion' }, approval: { status: 'approved' } };
    const proposalDone = await renderer.checkpoint({ ...proposalBase, stage: 'proposal', status: 'completed', artifacts: { proposal_packet: approvedProposal }, humanApproved: true, checkpoints: { research: researchDone, proposal: proposalWaiting } });
    assert.equal(proposalDone.status, 'completed');
  } finally {
    await renderer.dispose();
    assert.equal(path.dirname(scratch), path.resolve(os.tmpdir()));
    await rm(scratch, { recursive: true, force: true });
  }
});
