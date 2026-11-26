const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { gunzipSync } = require('node:zlib');

const html = readFileSync(process.env.CMRSEG_TEST_HTML ?? path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const modelSpacing = 350 / 256;
const sliceSpacing = 10;
const canvasContext = {
    createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    putImageData() {},
};

// Paint two-dimensional bands inside the centered 8 x 12 model-grid field of view.
function modelMask(bands) {
    const mask = new Uint8Array(224 * 224);
    for (let row = 108; row < 116; row++) {
        let start = row * 224 + 106;
        for (const [label, width] of bands) {
            mask.fill(label, start, start + width);
            start += width;
        }
    }
    return mask;
}

async function runAndExport(contrast, masks, { rows, cols, pixelSpacing }) {
    const handlers = new Map();
    const elements = new Map();
    const files = new Map();
    const table = { innerHTML: '', appendChild: (row) => { table.innerHTML += row.innerHTML; } };
    const nSlices = masks.length;
    const nPhases = masks[0].length;
    const nextMask = masks.flat().values();
    const context = vm.createContext({
        document: {
            getElementById(id) {
                if (!elements.has(id)) {
                    elements.set(id, {
                        style: {},
                        value: contrast,
                        getContext: () => canvasContext,
                        addEventListener: (event, callback) => handlers.set(id + ':' + event, callback),
                    });
                }
                return elements.get(id);
            },
            querySelector: () => table,
            createElement: () => ({ click() {} }),
        },
        window: { addEventListener() {} },
        JSZip: class {
            file(name, data) { files.set(name, data); }
            async generateAsync() { return new Blob(); }
        },
        Blob, CompressionStream, Response, URL, performance,
        nextMask,
        fixture: {
            rows, cols, pixelSpacing, nSlices, nPhases, sliceThickness: sliceSpacing,
            images: masks.map((slice) => slice.map(() => new Float32Array(rows * cols))),
        },
    });
    vm.runInContext(script, context);
    vm.runInContext(`
        dicomData = fixture;
        modelLoaded = true;
        inferInWorker = async () => nextMask.next().value;
    `, context);
    await handlers.get('runBtn:click')();
    await handlers.get('downloadBtn:click')();

    const csv = Object.fromEntries(files.get('measurements.csv').trimEnd().split('\n').slice(1)
        .map((line) => line.split(',')));
    for (const [metric, value] of Object.entries(csv)) {
        assert.ok(table.innerHTML.includes(`<td>${metric}</td><td>${value}</td>`));
    }
    const nifti = gunzipSync(files.get('labels.nii.gz'));
    assert.equal(nifti.readInt16LE(42), cols);
    assert.equal(nifti.readInt16LE(44), rows);
    assert.equal(nifti.readInt16LE(46), nSlices);
    assert.equal(nifti.readInt16LE(48), nPhases);
    const [dx, dy, dz] = [80, 84, 88].map((offset) => nifti.readFloatLE(offset));
    assert.deepEqual([dx, dy, dz], [pixelSpacing[1], pixelSpacing[0], sliceSpacing].map(Math.fround));
    const voxelVolume = dx * dy * dz / 1000;
    const dataOffset = nifti.readFloatLE(108);
    const voxelsPerPhase = rows * cols * nSlices;
    assert.equal(nifti.length - dataOffset, voxelsPerPhase * nPhases);
    const counts = Array.from({ length: nPhases }, (_, phase) => {
        const start = dataOffset + phase * voxelsPerPhase;
        const countsByLabel = [0, 0, 0, 0, 0];
        for (const label of nifti.subarray(start, start + voxelsPerPhase)) countsByLabel[label]++;
        return countsByLabel;
    });
    return { csv, counts, voxelVolume };
}

const matched = { rows: 8, cols: 12, pixelSpacing: [modelSpacing, modelSpacing] };
const resampled = { rows: 16, cols: 18, pixelSpacing: [modelSpacing / 2, modelSpacing * 2 / 3] };
const volume = (count, voxelVolume) => (count * voxelVolume).toFixed(1) + ' mL';
const percent = (fraction) => (fraction * 100).toFixed(1) + '%';

for (const [name, geometry, countScale] of [['matched', matched, 1], ['resampled', resampled, 3]]) {
    test(`CINE volumes and ejection fractions match NIfTI on the ${name} grid`, async () => {
        const masks = [
            [modelMask([[1, 2], [3, 2]]), modelMask([[1, 4], [3, 2]])],
            [modelMask([[1, 2]]), modelMask([[1, 2], [3, 4]])],
        ];
        const { csv, counts: [es, ed], voxelVolume } = await runAndExport('cine', masks, geometry);
        assert.equal(csv['ED Phase'], '2');
        assert.equal(csv['ES Phase'], '1');
        for (const [ventricle, label, edCount, esCount] of [['LV', 1, 48, 32], ['RV', 3, 48, 16]]) {
            assert.equal(ed[label], edCount * countScale);
            assert.equal(es[label], esCount * countScale);
            assert.equal(csv[ventricle + ' EDV'], volume(ed[label], voxelVolume));
            assert.equal(csv[ventricle + ' ESV'], volume(es[label], voxelVolume));
            assert.equal(csv[ventricle + ' EF'], percent((edCount - esCount) / edCount));
        }
    });

    test(`Scar/LGE and MVO volumes and percentages match NIfTI on the ${name} grid`, async () => {
        const masks = [
            [modelMask([[2, 4], [3, 2], [4, 2]])],
            [modelMask([[2, 6], [3, 2]])],
        ];
        const { csv, counts: [[, , myo, scar, mvo]], voxelVolume } = await runAndExport('scar', masks, geometry);
        assert.deepEqual([myo, scar, mvo], [80, 32, 16].map((count) => count * countScale));
        assert.equal(csv.Myocardium, volume(myo, voxelVolume));
        assert.equal(csv.Scar, volume(scar, voxelVolume) + ' (25.0%)');
        assert.equal(csv.MVO, volume(mvo, voxelVolume) + ' (12.5%)');
    });
}

test('Scar percentages follow the exported mask when resampling changes class proportions', async () => {
    const mask = modelMask([[2, 1], [3, 1]]);
    // This prediction lies in the model's padding and must be excluded.
    mask[108 * 224 + 105] = 4;
    const { csv, counts: [[, , myo, scar, mvo]], voxelVolume } = await runAndExport('scar', [[mask]], resampled);
    assert.deepEqual([myo, scar, mvo], [16, 32, 0]);
    assert.equal(csv.Myocardium, volume(myo, voxelVolume));
    assert.equal(csv.Scar, volume(scar, voxelVolume) + ' (66.7%)');
    assert.equal(csv.MVO, '0.0 mL (0.0%)');
});
