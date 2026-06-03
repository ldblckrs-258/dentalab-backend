import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import * as fs from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';
import mjml from 'mjml';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from '@common/constants';
import { EMAIL_TEMPLATE_METADATA } from '../email-metadata.constants';

const TEMPLATES_DIR = path.resolve(__dirname, '..', 'templates');
const TEMPLATE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

interface CompiledEntry {
  subject: Handlebars.TemplateDelegate;
  body: Handlebars.TemplateDelegate;
}

@Injectable()
export class TemplateService {
  private readonly logger = new Logger(TemplateService.name);
  private readonly compiledCache = new Map<string, CompiledEntry>();

  constructor(private readonly i18n: I18nService) {}

  render(
    templateName: string,
    variables: Record<string, unknown>,
    lang: string = DEFAULT_LANGUAGE,
  ): { html: string; subject: string } {
    const safeName = this.assertSafeName(templateName);
    const safeLang = this.assertSafeLang(lang);

    const cacheKey = `${safeName}::${safeLang}`;

    if (!this.compiledCache.has(cacheKey)) {
      this.compiledCache.set(cacheKey, this.compile(safeName, safeLang));
    }

    const compiled = this.compiledCache.get(cacheKey)!;

    // Clinic contact metadata is available to every template; caller-provided
    // variables win on key collision.
    const merged = { ...EMAIL_TEMPLATE_METADATA, ...variables };

    const subject = compiled.subject(merged);

    // Handlebars must run on the raw MJML (conditionals/loops intact) BEFORE
    // mjml2html: bare {{#if}} block tags sit between MJML components, and the
    // MJML compiler drops non-component text nodes — running Handlebars first
    // keeps the branch logic from being stripped.
    const resolvedMjml = compiled.body(merged);
    const { html, errors } = mjml(resolvedMjml, { validationLevel: 'soft' });
    if (errors?.length) {
      this.logger.warn(
        `MJML warnings for ${safeName} (${safeLang}): ${JSON.stringify(errors)}`,
      );
    }

    return { html, subject };
  }

  invalidateCache(templateName: string): void {
    const safeName = this.assertSafeName(templateName);
    for (const key of this.compiledCache.keys()) {
      if (key.startsWith(`${safeName}::`)) {
        this.compiledCache.delete(key);
      }
    }
  }

  private compile(templateName: string, lang: string): CompiledEntry {
    const resolvedLang = this.resolveLang(templateName, lang);

    const basePath = this.safeJoin('layouts', `base.${resolvedLang}.mjml`);
    const contentPath = this.safeJoin(`${templateName}.${resolvedLang}.mjml`);

    const baseSource = fs.readFileSync(basePath, 'utf-8');
    const contentSource = fs.readFileSync(contentPath, 'utf-8');
    const fullMjml = baseSource.replace('{{{content}}}', () => contentSource);

    const rawSubject = this.i18n.translate(
      `email.templates.${templateName}.subject`,
      { lang: resolvedLang, defaultValue: templateName },
    );

    return {
      subject: Handlebars.compile(rawSubject),
      body: Handlebars.compile(fullMjml),
    };
  }

  private resolveLang(templateName: string, lang: string): string {
    if (lang === DEFAULT_LANGUAGE) return DEFAULT_LANGUAGE;

    const contentPath = this.safeJoin(`${templateName}.${lang}.mjml`);
    if (fs.existsSync(contentPath)) return lang;

    this.logger.warn(
      `Template '${templateName}' not found for lang '${lang}', falling back to '${DEFAULT_LANGUAGE}'`,
    );

    const fallbackPath = this.safeJoin(
      `${templateName}.${DEFAULT_LANGUAGE}.mjml`,
    );
    if (!fs.existsSync(fallbackPath)) {
      throw new NotFoundException(`Email template '${templateName}' not found`);
    }

    return DEFAULT_LANGUAGE;
  }

  private assertSafeName(templateName: string): string {
    if (!TEMPLATE_NAME_PATTERN.test(templateName)) {
      throw new NotFoundException(
        `Invalid email template name: ${templateName}`,
      );
    }
    return templateName;
  }

  private assertSafeLang(lang: string): string {
    return (SUPPORTED_LANGUAGES as readonly string[]).includes(lang)
      ? lang
      : DEFAULT_LANGUAGE;
  }

  private safeJoin(...segments: string[]): string {
    const resolved = path.resolve(TEMPLATES_DIR, ...segments);
    if (
      resolved !== TEMPLATES_DIR &&
      !resolved.startsWith(TEMPLATES_DIR + path.sep)
    ) {
      throw new NotFoundException('Email template path traversal detected');
    }
    return resolved;
  }
}
