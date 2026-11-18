// Legacy validation files belong to the training pool in the two-dataset UI.
// Stored source labels/splits are not rewritten by this view mapping.
export const trainingDataset = split => split==='validation'?'train':split;
