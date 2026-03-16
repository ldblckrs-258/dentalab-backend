import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as Handlebars from 'handlebars';
import mjml from 'mjml';
import { PrismaService } from '@modules/database';

interface CompiledTemplate {
  subject: Handlebars.TemplateDelegate;
  body: Handlebars.TemplateDelegate;
}

@Injectable()
export class TemplateService {
  private readonly logger = new Logger(TemplateService.name);
  private readonly compiledCache = new Map<string, CompiledTemplate>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Render a template by name with the given variables.
   * Returns compiled HTML, rendered subject, and the template's DB id.
   *
   * Two-stage compilation:
   *  - Seed time: MJML (with {{handlebars}}) → body_html via mjml()
   *  - Render time: body_html (HTML with {{handlebars}}) → final HTML via Handlebars
   */
  async render(
    templateName: string,
    variables: Record<string, unknown>,
  ): Promise<{ html: string; subject: string; templateId: string }> {
    const template = await this.getTemplate(templateName);
    const compiled = this.getOrCompile(template.name, {
      subject: template.subject,
      bodyHtml: template.body_html,
    });

    const subject = compiled.subject(variables);
    const html = compiled.body(variables);

    return { html, subject, templateId: template.id };
  }

  /**
   * Compile MJML source to HTML. Used during seeding and template updates.
   * Keeps {{handlebars}} placeholders intact in the HTML output.
   */
  compileMjmlToHtml(mjmlSource: string): string {
    const result = mjml(mjmlSource, { validationLevel: 'soft' });
    if (result.errors?.length) {
      this.logger.warn(
        `MJML compilation warnings: ${JSON.stringify(result.errors)}`,
      );
    }
    return result.html;
  }

  /**
   * Invalidate cache for a specific template (called after DB update).
   */
  invalidateCache(templateName: string): void {
    this.compiledCache.delete(templateName);
  }

  private async getTemplate(name: string) {
    const template = await this.prisma.baseClient.emailTemplate.findUnique({
      where: { name },
    });
    if (!template) {
      throw new NotFoundException(`Email template '${name}' not found`);
    }
    if (!template.is_active) {
      throw new BadRequestException(`Email template '${name}' is disabled`);
    }
    return template;
  }

  private getOrCompile(
    name: string,
    source: { subject: string; bodyHtml: string },
  ): CompiledTemplate {
    if (!this.compiledCache.has(name)) {
      this.compiledCache.set(name, {
        subject: Handlebars.compile(source.subject),
        body: Handlebars.compile(source.bodyHtml),
      });
    }
    return this.compiledCache.get(name)!;
  }
}
