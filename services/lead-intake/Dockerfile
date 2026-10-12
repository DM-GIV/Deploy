FROM python:3.12-alpine
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY services/lead-intake/lead_intake.py /app/lead_intake.py
USER 10001:10001
EXPOSE 8081
CMD ["python", "-m", "lead_intake"]
