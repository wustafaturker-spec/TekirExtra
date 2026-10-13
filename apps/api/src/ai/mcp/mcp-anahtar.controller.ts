import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { McpAnahtarService } from "./mcp-anahtar.service";

/** AI-09: kullanıcının MCP erişim anahtarları (yönetici kiracıdakilerin hepsini görür ve iptal eder). */
@Controller("ai/mcp-anahtarlari")
export class McpAnahtarController {
  constructor(private readonly service: McpAnahtarService) {}

  @Get()
  listele() {
    return this.service.listele();
  }

  @Post()
  olustur(@Body() govde: { ad?: unknown }) {
    return this.service.olustur(typeof govde?.ad === "string" ? govde.ad : "");
  }

  @Post(":id/iptal")
  iptal(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.iptal(id);
  }
}
