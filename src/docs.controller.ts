import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import type { OpenAPIObject } from "@nestjs/swagger";

@Controller("docs")
export class DocsController {
  static document: OpenAPIObject | undefined;

  @Get()
  getDocument(): OpenAPIObject {
    if (!DocsController.document) throw new ServiceUnavailableException();
    return DocsController.document;
  }
}
