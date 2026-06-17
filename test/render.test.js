import { describe, it, expect, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import { renderPreserve, renderSheetDataReplace, renderFromConfig } from '../src/render.js';

describe('renderPreserve', () => {
  it('keeps template as-is when no overrides', async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('test');
    ws.getCell('A1').value = 'Original';

    const config = { sheet: 'test' };
    const state = { masters: [], edges: [] };

    await renderPreserve(config, state, workbook);

    expect(ws.getCell('A1').value).toBe('Original');
  });

  it('applies cell overrides', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('test');

    const config = {
      sheet: 'test',
      cell_overrides: [{ cell: 'A1', value: 'Overridden' }],
    };
    const state = { masters: [], edges: [] };

    await renderPreserve(config, state, workbook);

    expect(workbook.getWorksheet('test').getCell('A1').value).toBe('Overridden');
  });
});

describe('renderSheetDataReplace', () => {
  it('injects masters into rows starting at data_start_row', async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('releases');
    ws.getCell('A1').value = 'ID';
    ws.getCell('B1').value = 'Name';

    const config = {
      sheet: 'releases',
      source: 'release',
      data_start_row: 2,
      style_template_row: 2,
      columns: [
        { col: 1, src: 'id' },
        { col: 2, src: 'name' },
      ],
    };
    const state = {
      masters: [
        { type: 'release', id: 'rel-1', name: 'Alpha' },
        { type: 'release', id: 'rel-2', name: 'Beta' },
      ],
      edges: [],
    };

    await renderSheetDataReplace(config, state, workbook);

    expect(ws.getCell('A2').value).toBe('rel-1');
    expect(ws.getCell('B2').value).toBe('Alpha');
    expect(ws.getCell('A3').value).toBe('rel-2');
    expect(ws.getCell('B3').value).toBe('Beta');
  });

  it('filters masters by source type', async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('steps');

    const config = {
      sheet: 'steps',
      source: 'step',
      data_start_row: 2,
      columns: [{ col: 1, src: 'id' }],
    };
    const state = {
      masters: [
        { type: 'release', id: 'rel-1' },
        { type: 'step', id: 'stp-1' },
      ],
      edges: [],
    };

    await renderSheetDataReplace(config, state, workbook);

    expect(ws.getCell('A2').value).toBe('stp-1');
    expect(ws.getCell('A3').value).toBeNull();
  });

  it('applies literal values in columns', async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('test');

    const config = {
      sheet: 'test',
      data_start_row: 2,
      columns: [
        { col: 1, src: 'id' },
        { col: 2, literal: 'Status' },
      ],
    };
    const state = {
      masters: [{ id: 'a' }],
      edges: [],
    };

    await renderSheetDataReplace(config, state, workbook);

    expect(ws.getCell('A2').value).toBe('a');
    expect(ws.getCell('B2').value).toBe('Status');
  });

  it('applies edge lookups (FK joins)', async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('test');

    const config = {
      sheet: 'test',
      data_start_row: 2,
      columns: [
        { col: 1, src: 'id' },
        {
          col: 2,
          edge_lookup: {
            source: 'approval',
            match: { from_id: 'id' },
            select: 'approver_name',
          },
        },
      ],
    };
    const state = {
      masters: [{ id: 'rel-1', name: 'Release A' }],
      edges: [
        {
          type: 'approval',
          from_id: 'rel-1',
          approver_name: 'Alice',
        },
      ],
    };

    await renderSheetDataReplace(config, state, workbook);

    expect(ws.getCell('A2').value).toBe('rel-1');
    expect(ws.getCell('B2').value).toBe('Alice');
  });

  it('filters edge lookups by where clause', async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('test');

    const config = {
      sheet: 'test',
      data_start_row: 2,
      columns: [
        { col: 1, src: 'id' },
        {
          col: 2,
          edge_lookup: {
            match: { from_id: 'id' },
            where: { status: 'approved' },
            select: 'approver',
          },
        },
      ],
    };
    const state = {
      masters: [{ id: 'a' }],
      edges: [
        { from_id: 'a', status: 'pending', approver: 'Bob' },
        { from_id: 'a', status: 'approved', approver: 'Alice' },
      ],
    };

    await renderSheetDataReplace(config, state, workbook);

    expect(ws.getCell('B2').value).toBe('Alice');
  });
});

describe('renderFromConfig', () => {
  it('processes multiple sheet configs from JSONL', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('releases');
    workbook.addWorksheet('steps');

    const configContent = `{"sheet":"releases","strategy":"preserve"}\n{"sheet":"steps","strategy":"preserve"}\n`;
    const state = { masters: [], edges: [] };

    await renderFromConfig(configContent, state, workbook);

    expect(workbook.getWorksheet('releases')).toBeDefined();
    expect(workbook.getWorksheet('steps')).toBeDefined();
  });
});
