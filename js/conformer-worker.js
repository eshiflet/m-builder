// Runs the conformer search off the main thread so the page stays responsive.
import { parseSmiles } from './smiles.js';
import { generateConformers } from './forcefield.js';

self.onmessage = ({ data: { smiles } }) => {
  try {
    self.postMessage({ smiles, conformers: generateConformers(parseSmiles(smiles)) });
  } catch (e) {
    self.postMessage({ smiles, error: e.message });
  }
};
