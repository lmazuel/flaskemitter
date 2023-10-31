import {
  EmitContext,
  Model,
  Program,
  ModelProperty,
  ignoreDiagnostics,
  Operation,
  Interface,
  Tuple,
  Type,
  isArrayModelType,
  compilerAssert,
  isNullType,
} from "@typespec/compiler";
import {
  CodeTypeEmitter,
  Context,
  Declaration,
  EmitEntity,
  EmittedSourceFile,
  EmitterOutput,
  Scope,
  SourceFile,
  StringBuilder,
  TypeSpecDeclaration,
  code,
} from "@typespec/compiler/emitter-framework";
import {
  getHttpOperation,
  HttpOperationParameter
} from "@typespec/http";
import def from "ajv/dist/vocabularies/applicator/additionalItems.js";
import { openAsBlob } from "fs";
import Path from "path";

export async function $onEmit(context: EmitContext) {
  const assetEmitter = context.getAssetEmitter(MyCodeEmitter);
  assetEmitter.emitProgram();
  await assetEmitter.writeOutput();


  // const outputDir = Path.join(context.emitterOutputDir, "hello.txt");
  // await context.program.host.writeFile(outputDir, "hello world!");
}


class MyCodeEmitter extends CodeTypeEmitter {

  static readonly PYTHON_INDENT = "    ";
  static readonly FLASK_HEADER = `from flask import Flask, request

app = Flask(__name__)

`

  programContext(program: Program): Context {
    const sourceFile = this.emitter.createSourceFile("myapp.py");

    return {
      scope: sourceFile.globalScope,
    };
  }

  sourceFile(sourceFile: SourceFile<string>): EmittedSourceFile {

    const emittedSourceFile: EmittedSourceFile = {
      path: sourceFile.path,
      contents: MyCodeEmitter.FLASK_HEADER,
    };

    for (const decl of sourceFile.globalScope.declarations) {
      emittedSourceFile.contents += decl.value + "\n";
    }

    return emittedSourceFile;
  }

  buildParamName(paramName: string): string {
    // Probably not smart enough, but let's start somewhere
    return paramName.replace(/-/g, "_");
  }

  emitMethodSignature(params: HttpOperationParameter[]): StringBuilder {
    let buffer = new StringBuilder();
    for (const param of params) {
      if (param.type != "path") {
        continue;
      }
      buffer.push(this.buildParamName(param.name));
      if (param.param.default != undefined) {
        buffer.push("=");
        buffer.pushLiteralSegment(this.getDefaultValue(param.param.type, param.param.default));
      }
      buffer.push(", ");
    }
    return buffer;
  }

  emitMethodContent(params: HttpOperationParameter[]): StringBuilder {
    let buffer = new StringBuilder();
    for (const param of params) {
      buffer.push(MyCodeEmitter.PYTHON_INDENT);
      buffer.push(MyCodeEmitter.PYTHON_INDENT);
      buffer.push(MyCodeEmitter.PYTHON_INDENT);
      buffer.push(this.buildParamName(param.name));
      buffer.push("=");
      if (param.type == "query") {
        buffer.push(code`request.args.get("${param.name}")`);
      }
      else if (param.type == "header") {
        buffer.push(code`request.headers.get("${param.name}")`);
      }
      else { // Assume path
        buffer.push(this.buildParamName(param.name));
      }
      buffer.push(",\n");
    }
    return buffer;
  }

  buildOperationContent(operation: Operation, name: string): EmitterOutput<string> {
    const program = this.emitter.getProgram();
    this.emitter.getContext();
    const httpOperation = ignoreDiagnostics(getHttpOperation(program, operation));

    let flask_url_template = httpOperation.path.replace(/{/g, "<").replace(/}/g, ">")

    let myCode = code`
@app.route("${flask_url_template}", methods=['${httpOperation.verb.toUpperCase()}'])
def ${name}(${this.emitMethodSignature(httpOperation.parameters.parameters)}):
    try:
        from .impl import ${name}
        return ${name}(
            ${httpOperation.parameters.body ? "request.get_data(),  # Pass body as bytes" : "None,  # No body expected"}
${this.emitMethodContent(httpOperation.parameters.parameters)}
        )
    except ImportError:
        raise NotImplementedError()

`
    return this.emitter.result.declaration(name, myCode);
  }

  interfaceOperationDeclaration(operation: Operation, name: string): EmitterOutput<string> {
    return this.buildOperationContent(operation, name);
  }

  operationDeclaration(operation: Operation, name: string): EmitterOutput<string> {
    return this.buildOperationContent(operation, name);
  }

  // Copy/paste from
  // https://github.com/microsoft/typespec/blob/2fb62e6ba5bb8e2684b602e691d8747a3b246651/packages/openapi3/src/openapi.ts#L1601
  // Probably broken right now
  getDefaultValue(type: Type, defaultType?: Type): any {
    if (defaultType == undefined) {
      return undefined;
    }
    const program = this.emitter.getProgram();
    switch (defaultType.kind) {
      case "String":
        return defaultType.value;
      case "Number":
        return defaultType.value;
      case "Boolean":
        return defaultType.value;
      case "Tuple":
        compilerAssert(
          type.kind === "Tuple" || (type.kind === "Model" && isArrayModelType(program, type)),
          "setting tuple default to non-tuple value"
        );

        if (type.kind === "Tuple") {
          return defaultType.values.map((defaultTupleValue, index) =>
            this.getDefaultValue(type.values[index], defaultTupleValue)
          );
        } else {
          return defaultType.values.map((defaultTuplevalue) =>
            this.getDefaultValue(type.indexer!.value, defaultTuplevalue)
          );
        }

      // case "Intrinsic":
      //   return isNullType(defaultType)
      //     ? null
      //     : reportDiagnostic(program, {
      //         code: "invalid-default",
      //         format: { type: defaultType.kind },
      //         target: defaultType,
      //       });
      case "EnumMember":
        return defaultType.value ?? defaultType.name;
      default:
        console.log("Ho nooooooooooo");
        // reportDiagnostic(program, {
        //   code: "invalid-default",
        //   format: { type: defaultType.kind },
        //   target: defaultType,
        // });
    }
  }
}