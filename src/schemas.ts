import { Ajv } from 'ajv';
const ajv = new Ajv({ allErrors: true, strict: false });
const text = { type: 'string' };
const strings = { type: 'array', items: text };
const object = (properties: Record<string, unknown>) => ({ type:'object', properties, required:Object.keys(properties), additionalProperties:false });
const files = { type:'array', items:object({path:text, content:text, action:{enum:['write','delete']}}) };
export const schemas = {
  plan: object({summary:text,tasks:{type:'array',minItems:1,maxItems:12,items:object({id:text,title:text,description:text,allowedPaths:{...strings,minItems:1},dependsOn:strings,acceptance:{...strings,minItems:1}})}}),
  implement: object({status:{enum:['completed','needs_decision']},summary:text,question:text,files}),
  decide: object({status:{enum:['answered','needs_user']},answer:text}),
  tests: object({summary:text,files:{...files,minItems:1}}),
  review: object({verdict:{enum:['approved','changes_requested']},summary:text,findings:strings})
};
export function validate(schema: object, value: unknown) {
  const check=ajv.compile(schema);
  if(!check(value)) throw new Error('Respuesta del agente inválida: '+ajv.errorsText(check.errors));
}
