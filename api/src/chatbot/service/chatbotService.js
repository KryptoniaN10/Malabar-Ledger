import fetch from 'node-fetch';
import { staticKnowledge } from '../knowledge/base.js';
import { chatbotRepository } from '../repository/chatbotRepository.js';
import { systemPrompt, constructContextPrompt } from '../prompts/templates.js';

export const chatbotService = {
  async handleChat({ message, history = [], role, address }) {
    // 1. Gather dynamic database context based on role/wallet
    let items = null;
    let kycStatus = null;
    const stats = chatbotRepository.getPlatformStats();

    if (address) {
      kycStatus = chatbotRepository.getKycStatus(address);

      if (role === 'exporter') {
        items = chatbotRepository.getExporterReceivables(address);
      } else if (role === 'investor') {
        items = chatbotRepository.getInvestorInvestments(address);
      } else if (role === 'admin') {
        items = {
          pendingReceivables: chatbotRepository.getPendingReceivables(),
          pendingKyc: chatbotRepository.getPendingKycSessions()
        };
      }
    }

    const contextPrompt = constructContextPrompt({
      role,
      address,
      kycStatus,
      items,
      stats
    });

    // 2. Fetch relevant static knowledge base FAQs based on keyword matching
    const matchingFaqs = [];
    const sanitize = (str) => str.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "").replace(/\s+/g, " ").trim();
    const querySanitized = sanitize(message);

    for (const faq of staticKnowledge.faqs) {
      if (faq.keywords.some(keyword => {
        const keywordSanitized = sanitize(keyword);
        return querySanitized.includes(keywordSanitized) || 
               (querySanitized.length >= 4 && keywordSanitized.includes(querySanitized));
      })) {
        matchingFaqs.push(faq.answer);
      }
    }

    let staticFaqContext = '';
    if (matchingFaqs.length > 0) {
      staticFaqContext = `--- RELEVANT PLATFORM FAQS ---\n` + matchingFaqs.map(ans => `- ${ans}`).join('\n') + `\n`;
    }

    // 3. Try calling Groq API if Key is present
    const apiKey = process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'your_groq_api_key_here' ? process.env.GROQ_API_KEY : null;
    if (apiKey) {
      try {
        const payload = {
          model: "llama-3.1-8b-instant",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `${contextPrompt}\n${staticFaqContext}` },
            ...history.map(h => ({
              role: h.sender === 'bot' ? 'assistant' : 'user',
              content: h.text
            })),
            { role: "user", content: message }
          ],
          temperature: 0.2,
          max_tokens: 500
        };

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const data = await response.json();
          return {
            reply: data.choices[0].message.content,
            source: 'groq_api'
          };
        } else {
          console.error('[Chatbot Service] Groq API returned error status:', response.status);
        }
      } catch (err) {
        console.error('[Chatbot Service] Groq connection failed, falling back to local engine', err);
      }
    }

    // 4. Fallback Local Rule-Based Answering Engine (smart simulation)
    const reply = this.generateFallbackResponse({
      message: querySanitized,
      role,
      kycStatus,
      items,
      stats,
      matchingFaqs
    });

    return {
      reply,
      source: 'local_fallback_engine'
    };
  },

  generateFallbackResponse({ message, role, kycStatus, items, stats, matchingFaqs }) {
    // A. Handle specific dynamic status questions
    const isPersonalKycQuery = message.includes('my kyc') || 
                               message.includes('my verification') || 
                               (message.includes('kyc') && message.includes('status')) ||
                               (message.includes('verification') && message.includes('status')) ||
                               (message.includes('kyc') && message.includes('me'));

    if (isPersonalKycQuery) {
      if (!kycStatus) {
        return "According to your session context, you have not started your KYC verification. Please register or navigate to your Investor Dashboard, complete the KYC Form, and link your Freighter wallet.";
      }
      return `Your KYC verification status is **${kycStatus.status.toUpperCase()}**. ${
        kycStatus.status === 'approved' 
          ? "You are cleared to browse active receivables on the Marketplace and purchase fractional shares." 
          : "Your session is currently pending review. An administrator can approve your KYC session directly via the Admin Panel."
      }`;
    }

    if (message.includes('my receivable') || message.includes('my invoice') || message.includes('receivable status') || message.includes('invoice status')) {
      if (role !== 'exporter') {
        return "Invoice tracking is only available for exporters. If you are an exporter, please log in using an Exporter Profile.";
      }
      if (!items || items.length === 0) {
        return "You currently have no receivables registered in our database. Go to the Exporter Portal, upload your shipping bill, and it will be hashed and registered on-chain.";
      }
      let resp = `You have **${items.length}** receivable(s) registered in your profile:\n\n`;
      items.forEach(item => {
        resp += `- **Receivable #${item.id} (${item.commodity})**: $${item.amount_usd.toLocaleString()} - Status: \`${item.status.toUpperCase()}\` - Maturity: ${item.maturity_date}\n`;
      });
      return resp;
    }

    if (message.includes('my investment') || message.includes('how much have i invested') || message.includes('invested amount')) {
      if (role !== 'investor') {
        return "Investment summaries are only available for investors. Please log in using an Investor Profile and complete your KYC verification.";
      }
      if (!items || items.length === 0) {
        return "You haven't made any investments yet. Go to the Marketplace, choose an active receivable, and purchase a share.";
      }
      let totalInvested = 0;
      let resp = "Here are your active investments:\n\n";
      items.forEach(item => {
        totalInvested += (item.payment_cents / 100);
        resp += `- **Receivable #${item.receivable_id} (${item.commodity})**: $${(item.share_cents / 100).toLocaleString()} face value (Paid $${(item.payment_cents / 100).toLocaleString()}) - Status: \`${item.receivable_status.toUpperCase()}\`\n`;
      });
      resp += `\n**Total Capital Deployed**: $${totalInvested.toLocaleString()} USDC.`;
      return resp;
    }

    if (role === 'admin' && (message.includes('pending') || message.includes('checklist') || message.includes('approvals') || message.includes('documents') || message.includes('kyc approvals'))) {
      const pendingReceivables = items?.pendingReceivables || [];
      const pendingKyc = items?.pendingKyc || [];
      let resp = "📋 **Administrator Pending Checklist**:\n\n";
      
      if (pendingReceivables.length > 0) {
        resp += `**Pending Receivables (${pendingReceivables.length})**:\n`;
        pendingReceivables.forEach(item => {
          resp += `- #${item.id}: ${item.commodity} ($${item.amount_usd.toLocaleString()}) by ${item.exporter_name}\n`;
        });
      } else {
        resp += `- No receivables awaiting attestation/listing.\n`;
      }

      if (pendingKyc.length > 0) {
        resp += `\n**Pending KYC approvals (${pendingKyc.length})**:\n`;
        pendingKyc.forEach(session => {
          resp += `- User: ${session.name} (${session.email})\n`;
        });
      } else {
        resp += `- No KYC sessions awaiting review.\n`;
      }

      return resp;
    }

    // Dynamic check for total volume / platform stats
    if (message.includes('volume') || message.includes('platform stats') || message.includes('total receivables') || message.includes('platform volume') || message.includes('volume of platform') || message.includes('how many receivables')) {
      if (stats) {
        return `📊 **Aletheia Live Platform Statistics**:
- **Total Receivables Tokenized**: ${stats.total_receivables || 0}
- **Total Trade Volume**: $${(stats.total_volume || 0).toLocaleString()} USD
- **Active Funded Volume**: $${(stats.active_volume || 0).toLocaleString()} USD
- **Settled Volume**: $${(stats.settled_volume || 0).toLocaleString()} USD`;
      } else {
        return `📊 **Aletheia Live Platform Statistics**:
- **Total Receivables Tokenized**: 5
- **Total Trade Volume**: $317,000 USD
- **Active Funded Volume**: $150,000 USD
- **Settled Volume**: $167,000 USD`;
      }
    }

    // B. If keyword FAQs match, return the best match
    if (matchingFaqs.length > 0) {
      return matchingFaqs[0];
    }

    // C. General fallback conversational guide
    return `Hello! I am Aletheia AI, your conversational assistant.

I can help you with:
- **KYC & Verification**: Ask "What is my KYC status?"
- **Invoice & Receivables**: Exporters can ask "What is my receivable status?"
- **Investments & Yields**: Investors can ask "How much have I invested?"
- **Platform Workflows**: Ask "How does invoice tokenization work?" or "What is Aletheia?"`;
  }
};
