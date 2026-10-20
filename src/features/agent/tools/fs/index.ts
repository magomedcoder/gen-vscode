import { registerTool } from '../registry';
import { applyDiffTool } from './applyDiff';
import { applyPatchTool } from './applyPatch';
import { applyWorkspaceEditTool } from './applyWorkspaceEdit';
import { createDirTool } from './createDir';
import { deleteFileTool } from './deleteFile';
import { editFileTool } from './editFile';
import { editNotebookTool } from './editNotebook';
import { listDirTool } from './listDir';
import { readFileTool } from './readFile';
import { writeFileTool } from './writeFile';

export function registerFsTools(): void {
	registerTool(listDirTool, { 
		tags: ['fs'], 
		risk: 'read' 
	});
	registerTool(readFileTool, { 
		tags: ['fs'], 
		risk: 'read' 
	});
	registerTool(writeFileTool, { 
		tags: ['fs'], 
		risk: 'write' 
	});
	registerTool(applyDiffTool, {
		tags: ['fs'],
		risk: 'write',
	});
	registerTool(applyPatchTool, { 
		tags: ['fs'], 
		risk: 'write' 
	});
	registerTool(editFileTool, {
		tags: ['fs'],
		risk: 'write',
	});
	registerTool(applyWorkspaceEditTool, { 
		tags: ['fs'], 
		risk: 'write' 
	});
	registerTool(editNotebookTool, { 
		tags: ['fs'], 
		risk: 'write' 
	});
	registerTool(deleteFileTool, { 
		tags: ['fs'], 
		risk: 'write' 
	});
	registerTool(createDirTool, { 
		tags: ['fs'], 
		risk: 'write' 
	});
}
