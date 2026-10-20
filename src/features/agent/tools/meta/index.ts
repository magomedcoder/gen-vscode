import { registerTool } from '../registry';
import { webSearchTool } from '../search/fileSearchWeb';
import { taskTool } from '../shell/taskShell';
import { designInspectTool } from './designInspect';
import { designScreenshotTool } from './designScreenshot';
import { fetchPageTool } from './fetchPage';
import { findLogsTool } from './findLogs';
import { generateAgentTool } from './generateAgent';
import { getWorkspaceInfoTool } from './getWorkspaceInfo';
import { newTaskTool } from './newTask';
import { openBrowserTool } from './openBrowser';
import { listPluginsTool, pluginTool, runPluginTool } from './plugins';
import { readLogTailTool } from './readLogTail';
import { registerEphemeralToolTool } from './registerEphemeralTool';
import { repoHealthTool } from './repoHealth';
import { testImpactTool } from './testImpact';
import { askQuestionTool, skillTool, todoReadTool, todoWriteTool } from './todoQuestionSkill';

export function registerMetaTools(): void {
	registerTool(getWorkspaceInfoTool, { 
		tags: ['meta'], 
		risk: 'read' 
	});
	registerTool(findLogsTool, { 
		tags: ['meta'], 
		risk: 'read' 
	});
	registerTool(readLogTailTool, { 
		tags: ['meta'], 
		risk: 'read' 
	});
	registerTool(todoWriteTool, { 
		tags: ['meta'], 
		risk: 'write' 
	});
	registerTool(todoReadTool, { 
		tags: ['meta'], 
		risk: 'read' 
	});
	registerTool(askQuestionTool, { 
		tags: ['meta'], 
		risk: 'read' 
	});
	registerTool(skillTool, { 
		tags: ['meta'], 
		risk: 'read' 
	});
	registerTool(listPluginsTool, { 
		tags: ['meta'], 
		risk: 'read' 
	});
	registerTool(pluginTool, { 
		tags: ['meta'], 
		risk: 'read' 
	});
	registerTool(runPluginTool, {
		tags: ['meta'],
		risk: 'shell',
	});
	registerTool(taskTool, { 
		tags: ['meta'], 
		risk: 'read' 
	});
	registerTool(newTaskTool, {
		tags: ['meta'],
		risk: 'read',
	});
	registerTool(generateAgentTool, { 
		tags: ['meta'], 
		risk: 'write' 
	});
	registerTool(registerEphemeralToolTool, {
		tags: ['meta'],
		risk: 'read',
	});
	registerTool(repoHealthTool, {
		tags: ['meta'],
		risk: 'read',
	});
	registerTool(testImpactTool, {
		tags: ['meta'],
		risk: 'read',
	});
	registerTool(webSearchTool, { 
		tags: ['meta'], 
		risk: 'web' 
	});
	registerTool(openBrowserTool, { 
		tags: ['meta'], 
		risk: 'web' 
	});
	registerTool(fetchPageTool, { 
		tags: ['meta'], 
		risk: 'web' 
	});
	registerTool(designInspectTool, {
		tags: ['meta'],
		risk: 'web',
	});
	registerTool(designScreenshotTool, {
		tags: ['meta'],
		risk: 'web',
	});
}
